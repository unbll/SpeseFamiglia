import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query } from 'firebase/firestore';

// Variabili di configurazione Firebase (DA SOSTITUIRE CON I TUOI DATI REALI!)
const firebaseConfig = {
  apiKey: "IL_TUO_API_KEY_QUI",
  authDomain: "IL_TUO_AUTH_DOMAIN_QUI",
  projectId: "IL_TUO_PROJECT_ID_QUI",
  storageBucket: "IL_TUO_STORAGE_BUCKET_QUI",
  messagingSenderId: "IL_TUO_MESSAGING_SENDER_ID_QUI",
  appId: "IL_TUO_APP_ID_DI_FIREBASE_QUI" // Questo è l'appId di Firebase, non il nostro appId logico
};

// Il tuo ID logico per l'applicazione (può essere una stringa a tua scelta, usala per la collezione Firestore)
const appId = 'IL_TUO_APP_ID_UNICO_QUI'; // Esempio: 'spese-famiglia-rossi'

function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('Io'); // Default payer
  const [category, setCategory] = useState('Casa'); // Default category
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userName1, setUserName1] = useState('Io');
  const [userName2, setUserName2] = useState('La mia ragazza');
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const [showHistory, setShowHistory] = useState(false); 
  const [showMonthlyTable, setShowMonthlyTable] = useState(false);
  const [showAnnualTable, setShowAnnualTable] = useState(false);
  const [showRecentExpenses, setShowRecentExpenses] = useState(false); 

  // New states for user filters in tables/history
  const [monthlyFilterUser, setMonthlyFilterUser] = useState('Tutti');
  const [annualFilterUser, setAnnualFilterUser] = useState('Tutti');
  const [historyFilterUser, setHistoryFilterUser] = useState('Tutti'); 

  // State for aggregated data (overall totals/averages - not affected by filters)
  const [perpetualTotal, setPerpetualTotal] = useState(0);
  const [monthlyAverage, setMonthlyAverage] = useState(0);
  const [annualAverage, setAnnualAverage] = useState(0);
  const [spendingByCategory, setSpendingByCategory] = useState({}); // New state for spending by category

  // States for LLM integration
  const [llmInsight, setLlmInsight] = useState(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState(null);
  const [showLlmInsight, setShowLlmInsight] = useState(false); // State to toggle LLM insight visibility

  // Utility function for exponential backoff
  const retryFetch = async (url, options, retries = 3, delay = 1000) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 429 && retries > 0) { // Too Many Requests
          console.warn(`Rate limit hit, retrying in ${delay / 1000}s...`);
          await new Promise(res => setTimeout(res, delay));
          return retryFetch(url, options, retries - 1, delay * 2);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      console.error("Fetch failed:", error);
      throw error;
    }
  };

  // Initialize Firebase and authenticate
  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);

        setDb(firestoreDb);
        setAuth(firebaseAuth);

        // Su Firebase Hosting, useremo l'autenticazione anonima o altri metodi Firebase.
        // Rimuoviamo la dipendenza da __initial_auth_token che è specifica dell'ambiente Canvas.
        await signInAnonymously(firebaseAuth);
        
        onAuthStateChanged(firebaseAuth, (user) => {
          if (user) {
            setUserId(user.uid);
            console.log("Authenticated with userId:", user.uid);
          } else {
            console.log("No user is signed in.");
            setUserId(crypto.randomUUID()); // Fallback for unauthenticated users
          }
          setLoading(false);
        });
      } catch (e) {
        console.error("Error initializing Firebase or during authentication:", e);
        setError("Errore nell'inizializzazione dell'applicazione o nell'autenticazione. Riprova più tardi.");
        setLoading(false);
      }
    };

    initializeFirebase();
  }, [firebaseConfig]); // initialAuthToken rimosso dalle dipendenze

  // Fetch expenses from Firestore
  useEffect(() => {
    if (!db || !userId) {
      console.log("Firestore or userId not ready for fetching expenses.");
      return;
    }

    console.log("Fetching expenses for userId:", userId);
    // Path per i dati pubblici su Firestore: /artifacts/{appId}/public/data/{your_collection_name}
    // Assicurati che le regole di sicurezza di Firestore permettano la lettura/scrittura per gli utenti autenticati.
    const expensesCollectionRef = collection(db, `artifacts/${appId}/public/data/expenses`);
    const q = query(expensesCollectionRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedExpenses = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedExpenses.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
      setExpenses(fetchedExpenses);
      setError(null); 
      console.log("Expenses fetched successfully.");
    }, (err) => {
      console.error("Error fetching expenses:", err);
      setError("Errore nel caricamento delle spese. Riprova. Controlla i permessi di Firestore.");
    });

    return () => unsubscribe();
  }, [db, userId]);

  // Process overall spending data (perpetual, monthly/annual averages, and by category)
  useEffect(() => {
    const processOverallSpendingData = () => {
      let totalSum = 0;
      const uniqueMonths = new Set();
      const uniqueYears = new Set();
      const categoryTotals = {}; 

      expenses.forEach(expense => {
        const date = expense.timestamp?.toDate();
        if (date) {
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const monthYear = `${year}-${String(month).padStart(2, '0')}`;
          totalSum += expense.amount;
          uniqueMonths.add(monthYear);
          uniqueYears.add(year);

          categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
        }
      });

      const avgMonthly = uniqueMonths.size > 0 ? totalSum / uniqueMonths.size : 0;
      const avgAnnual = uniqueYears.size > 0 ? totalSum / uniqueYears.size : 0;

      setPerpetualTotal(totalSum);
      setMonthlyAverage(avgMonthly);
      setAnnualAverage(avgAnnual);
      setSpendingByCategory(categoryTotals); 
    };

    processOverallSpendingData();
  }, [expenses]);

  // Derived data for Monthly Spending Table (filtered by monthlyFilterUser)
  const filteredMonthlySpendingData = useMemo(() => {
    const monthlyTotals = {};
    expenses.forEach(expense => {
      const date = expense.timestamp?.toDate();
      if (date && (monthlyFilterUser === 'Tutti' || expense.paidBy === monthlyFilterUser)) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        monthlyTotals[monthYear] = (monthlyTotals[monthYear] || 0) + expense.amount;
      }
    });
    return Object.keys(monthlyTotals)
      .sort()
      .map(key => ({ name: key, total: monthlyTotals[key] }));
  }, [expenses, monthlyFilterUser]);

  // Derived data for Annual Spending Table (filtered by annualFilterUser)
  const filteredAnnualSpendingData = useMemo(() => {
    const annualTotals = {};
    expenses.forEach(expense => {
      const date = expense.timestamp?.toDate();
      if (date && (annualFilterUser === 'Tutti' || expense.paidBy === annualFilterUser)) {
        const year = date.getFullYear();
        annualTotals[year] = (annualTotals[year] || 0) + expense.amount;
      }
    });
    return Object.keys(annualTotals)
      .sort()
      .map(key => ({ name: key, total: annualTotals[key] }));
  }, [expenses, annualFilterUser]);

  // Derived data for Historical Spending Section (filtered by historyFilterUser)
  const filteredHistoricalData = useMemo(() => {
    const annualDataMap = {};
    expenses.forEach(expense => {
      const date = expense.timestamp?.toDate();
      if (date && (historyFilterUser === 'Tutti' || expense.paidBy === historyFilterUser)) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;

        if (!annualDataMap[year]) {
          annualDataMap[year] = { total: 0, months: {} };
        }
        annualDataMap[year].total += expense.amount;
        
        if (!annualDataMap[year].months[monthYear]) {
          annualDataMap[year].months[monthYear] = { total: 0, expenses: [] };
        }
        annualDataMap[year].months[monthYear].total += expense.amount;
        annualDataMap[year].months[monthYear].expenses.push(expense); 
      }
    });

    return Object.keys(annualDataMap)
      .sort()
      .map(year => ({
        name: year,
        total: annualDataMap[year].total,
        months: Object.keys(annualDataMap[year].months)
          .sort()
          .map(monthKey => ({
            name: monthKey,
            total: annualDataMap[year].months[monthKey].total,
            expenses: annualDataMap[year].months[monthKey].expenses.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0)) 
          }))
      }));
  }, [expenses, historyFilterUser]);


  // Calculate balance for current period
  const calculateBalance = useCallback(() => {
    let totalPaidBy1 = 0;
    let totalPaidBy2 = 0;
    let totalOverallExpenses = 0;

    expenses.forEach(expense => {
      totalOverallExpenses += expense.amount;
      if (expense.paidBy === userName1) {
        totalPaidBy1 += expense.amount;
      } else if (expense.paidBy === userName2) {
        totalPaidBy2 += expense.amount;
      }
    });

    const sharePerPerson = totalOverallExpenses / 2;

    const user1Net = totalPaidBy1 - sharePerPerson; 
    const user2Net = totalPaidBy2 - sharePerPerson; 

    let summary = 'Siete in pari!';
    if (user1Net > 0.01) { 
      summary = `${userName2} deve dare ${userName1} ${Math.abs(user1Net).toFixed(2)}€`;
    } else if (user2Net > 0.01) { 
      summary = `${userName1} deve dare ${userName2} ${Math.abs(user2Net).toFixed(2)}€`;
    }

    return {
      netBalance: user1Net, 
      summary: summary
    };
  }, [expenses, userName1, userName2]);

  const { netBalance, summary } = calculateBalance(); 

  // Handle balance settlement
  const handleSettleBalance = async () => {
    if (!db) {
      setError("Database non disponibile.");
      return;
    }

    if (Math.abs(netBalance) < 0.01) { 
      setError("Il saldo è già in pari o quasi. Nessun ripristino necessario.");
      return;
    }

    const settlementAmount = Math.abs(netBalance);
    let payer = '';
    let description = '';

    if (netBalance > 0) { 
      payer = userName2;
      description = `Ripianamento saldo da ${userName2} a ${userName1}`;
    } else { 
      payer = userName1;
      description = `Ripianamento saldo da ${userName1} a ${userName2}`;
    }

    try {
      setLoading(true);
      const expensesCollectionRef = collection(db, `artifacts/${appId}/public/data/expenses`);
      await addDoc(expensesCollectionRef, {
        description: description,
        amount: settlementAmount,
        paidBy: payer,
        category: 'Saldo Ripianato', 
        timestamp: new Date()
      });
      setError(null);
      console.log("Balance settled successfully.");
    } catch (e) {
      console.error("Error settling balance: ", e);
      setError("Errore nel ripristino del saldo. Riprova.");
    } finally {
      setLoading(false);
    }
  };

  // Function to get spending insights from Gemini API
  const getSpendingInsights = async () => {
    setLlmLoading(true);
    setLlmError(null);
    setLlmInsight(null);
    setShowLlmInsight(true); 

    const spendingDataSummary = {
      perpetualTotal: perpetualTotal.toFixed(2),
      monthlyAverage: monthlyAverage.toFixed(2),
      annualAverage: annualAverage.toFixed(2),
      spendingByCategory: Object.entries(spendingByCategory).map(([cat, val]) => ({ category: cat, total: val.toFixed(2) })),
      monthlyTrends: filteredMonthlySpendingData.map(data => ({ month: `${getMonthName(data.name)} ${data.name.split('-')[0]}`, total: data.total.toFixed(2) })),
      annualTrends: filteredAnnualSpendingData.map(data => ({ year: data.name, total: data.total.toFixed(2) }))
    };

    const prompt = `Analizza i seguenti dati sulle spese di una coppia e fornisci consigli personalizzati per la gestione del budget, suggerimenti per il risparmio e intuizioni sull'andamento delle spese. Considera i totali perpetui, le medie mensili e annuali, la ripartizione per categoria e gli andamenti mensili e annuali. Presenta le tue intuizioni in modo chiaro e conciso, evidenziando le aree di maggiore spesa e potenziali opportunità di ottimizzazione.
    
    Dati aggregati sulle spese:
    Totale Perpetuo: ${spendingDataSummary.perpetualTotal}€
    Media Mensile: ${spendingDataSummary.monthlyAverage}€
    Media Annuale: ${spendingDataSummary.annualAverage}€

    Spese per Categoria:
    ${spendingDataSummary.spendingByCategory.map(item => `- ${item.category}: ${item.total}€`).join('\n')}

    Andamento Mensile:
    ${spendingDataSummary.monthlyTrends.map(item => `- ${item.month}: ${item.total}€`).join('\n')}

    Andamento Annuale:
    ${spendingDataSummary.annualTrends.map(item => `- Anno ${item.year}: ${item.total}€`).join('\n')}
    `;

    try {
      const chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = ""; 
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const result = await retryFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setLlmInsight(text);
      } else {
        setLlmError("Nessun consiglio generato. Riprova.");
      }
    } catch (e) {
      console.error("Error calling Gemini API:", e);
      setLlmError("Errore nella generazione dei consigli. Riprova.");
    } finally {
      setLlmLoading(false);
    }
  };

  // Add a new expense
  const addExpense = async () => {
    if (!db || !description || !amount || isNaN(parseFloat(amount))) {
      setError("Per favore, inserisci una descrizione e un importo valido.");
      return;
    }

    try {
      setLoading(true);
      const expensesCollectionRef = collection(db, `artifacts/${appId}/public/data/expenses`);
      await addDoc(expensesCollectionRef, {
        description,
        amount: parseFloat(amount),
        paidBy,
        category,
        timestamp: new Date()
      });
      setDescription('');
      setAmount('');
      setError(null);
      console.log("Expense added successfully.");
    } catch (e) {
      console.error("Error adding document: ", e);
      setError("Errore nell'aggiunta della spesa. Riprova.");
    } finally {
      setLoading(false);
    }
  };

  // Confirm deletion of an expense
  const confirmDeleteExpense = (expenseId) => {
    setExpenseToDelete(expenseId);
    setShowConfirmModal(true);
  };

  // Delete an expense
  const deleteExpense = async () => {
    if (!db || !expenseToDelete) return;

    try {
      setLoading(true);
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/expenses`, expenseToDelete));
      setError(null);
      console.log("Expense deleted successfully.");
    } catch (e) {
      console.error("Error deleting document: ", e);
      setError("Errore nell'eliminazione della spesa. Riprova.");
    } finally {
      setLoading(false);
      setShowConfirmModal(false);
      setExpenseToDelete(null);
    }
  };

  // Categories and Payer options
  const categories = ['Casa', 'Cibo', 'Svago', 'Trasporti', 'Salute', 'Altro', 'Saldo Ripianato']; 

  // Helper to format month name
  const getMonthName = (monthYear) => {
    const [year, month] = monthYear.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleString('it-IT', { month: 'long' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-gray-100">
        <div className="text-xl animate-pulse">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-gray-100 font-inter p-4 sm:p-6 md:p-8 flex flex-col items-center">
      {/* Tailwind CSS and Inter font configuration */}
      <script src="https://cdn.tailwindcss.com"></script>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        body {
          font-family: 'Inter', sans-serif;
        }
      `}</style>

      <div className="w-full max-w-3xl bg-zinc-800 rounded-xl shadow-lg p-6 sm:p-8 md:p-10 mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-purple-400 mb-4 text-center">
          Gestione Spese di Coppia
        </h1>
        <p className="text-gray-400 text-center mb-6">
          ID Utente: <span className="font-mono text-sm break-all">{userId}</span>
        </p>

        {error && (
          <div className="bg-red-700 text-white p-3 rounded-lg mb-4 text-center">
            {error}
          </div>
        )}

        {/* Balance Summary */}
        <div className="bg-zinc-700 p-4 rounded-lg mb-6 text-center shadow-inner">
          <h2 className="text-xl font-semibold text-gray-200 mb-2">Riepilogo Saldo Attuale</h2>
          <p className="text-2xl font-bold text-emerald-400 mb-4">
            {summary}
          </p>
          <button
            onClick={handleSettleBalance}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
          >
            Ripiana Saldo Attuale
          </button>
        </div>

        {/* Add Expense Form */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-purple-300 mb-4">Aggiungi Nuova Spesa</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="description" className="block text-gray-300 text-sm font-medium mb-1">Descrizione</label>
              <input
                type="text"
                id="description"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Es. Affitto, Cena fuori"
              />
            </div>
            <div>
              <label htmlFor="amount" className="block text-gray-300 text-sm font-medium mb-1">Importo (€)</label>
              <input
                type="number"
                id="amount"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Es. 150.50"
                step="0.01"
              />
            </div>
            <div>
              <label htmlFor="paidBy" className="block text-gray-300 text-sm font-medium mb-1">Pagato da</label>
              <select
                id="paidBy"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
              >
                <option value={userName1}>{userName1}</option>
                <option value={userName2}>{userName2}</option>
              </select>
            </div>
            <div>
              <label htmlFor="category" className="block text-gray-300 text-sm font-medium mb-1">Categoria</label>
              <select
                id="category"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={addExpense}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
          >
            Aggiungi Spesa
          </button>
        </div>

        {/* Total Spending Summary */}
        <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
          <h2 className="text-2xl font-semibold text-purple-300 mb-4">Riepilogo Spese Totali</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="bg-zinc-600 p-4 rounded-lg shadow-sm">
              <p className="text-gray-400 text-sm">Totale Perpetuo</p>
              <p className="text-xl font-bold text-emerald-300">{perpetualTotal.toFixed(2)}€</p>
            </div>
            <div className="bg-zinc-600 p-4 rounded-lg shadow-sm">
              <p className="text-gray-400 text-sm">Media Mensile</p>
              <p className="text-xl font-bold text-emerald-300">{monthlyAverage.toFixed(2)}€</p>
            </div>
            <div className="bg-zinc-600 p-4 rounded-lg shadow-sm">
              <p className="text-gray-400 text-sm">Media Annuale</p>
              <p className="text-xl font-bold text-emerald-300">{annualAverage.toFixed(2)}€</p>
            </div>
          </div>
        </div>

        {/* Smart Spending Insights Section (Gemini API Integration) */}
        <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
          <button
            onClick={() => setShowLlmInsight(!showLlmInsight)}
            className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
          >
            {showLlmInsight ? 'Nascondi Consigli Intelligenti ✨' : 'Ottieni Consigli Intelligenti sulle Spese ✨'}
          </button>
          {showLlmInsight && (
            <div className="mt-4">
              <h3 className="text-xl font-semibold text-purple-300 mb-4">Consigli di Gemini</h3>
              {llmLoading ? (
                <p className="text-gray-400 text-center animate-pulse">Generazione consigli...</p>
              ) : llmError ? (
                <p className="text-red-400 text-center">{llmError}</p>
              ) : llmInsight ? (
                <div className="bg-zinc-800 p-4 rounded-lg shadow-sm whitespace-pre-wrap text-gray-200">
                  {llmInsight}
                </div>
              ) : (
                <p className="text-gray-400 text-center">Clicca il pulsante per ottenere consigli sulle tue spese.</p>
              )}
              {!llmLoading && (
                <button
                  onClick={getSpendingInsights}
                  className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
                >
                  Rigenera Consigli ✨
                </button>
              )}
            </div>
          )}
        </div>

        {/* Spending Trends Tables */}
        <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
          <h2 className="text-2xl font-semibold text-purple-300 mb-4">Andamento Spese (Tabelle)</h2>

          {/* Monthly Spending Table */}
          <div className="mb-6">
            <button
              onClick={() => setShowMonthlyTable(!showMonthlyTable)}
              className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
            >
              {showMonthlyTable ? 'Nascondi Tabella Mensile' : 'Mostra Tabella Mensile'}
            </button>
            {showMonthlyTable && (
              <>
                <div className="mt-4 mb-2">
                  <label htmlFor="monthlyFilterUser" className="block text-gray-300 text-sm font-medium mb-1">Filtra per utente:</label>
                  <select
                    id="monthlyFilterUser"
                    className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                    value={monthlyFilterUser}
                    onChange={(e) => setMonthlyFilterUser(e.target.value)}
                  >
                    <option value="Tutti">Tutti</option>
                    <option value={userName1}>{userName1}</option>
                    <option value={userName2}>{userName2}</option>
                  </select>
                </div>
                {filteredMonthlySpendingData.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full bg-zinc-800 rounded-lg shadow-md">
                      <thead>
                        <tr className="bg-zinc-700 text-gray-300 uppercase text-sm leading-normal">
                          <th className="py-3 px-6 text-left rounded-tl-lg">Mese</th>
                          <th className="py-3 px-6 text-right rounded-tr-lg">Totale Speso (€)</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-200 text-sm font-light">
                        {filteredMonthlySpendingData.map((data, index) => (
                          <tr key={index} className="border-b border-zinc-600 hover:bg-zinc-700">
                            <td className="py-3 px-6 text-left whitespace-nowrap">{getMonthName(data.name)} {data.name.split('-')[0]}</td>
                            <td className="py-3 px-6 text-right">{data.total.toFixed(2)}€</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center mt-4">Nessuna spesa disponibile per la selezione corrente.</p>
                )}
              </>
            )}
          </div>

          {/* Annual Spending Table */}
          <div>
            <button
              onClick={() => setShowAnnualTable(!showAnnualTable)}
              className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
            >
              {showAnnualTable ? 'Nascondi Tabella Annuale' : 'Mostra Tabella Annuale'}
            </button>
            {showAnnualTable && (
              <>
                <div className="mt-4 mb-2">
                  <label htmlFor="annualFilterUser" className="block text-gray-300 text-sm font-medium mb-1">Filtra per utente:</label>
                  <select
                    id="annualFilterUser"
                    className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                    value={annualFilterUser}
                    onChange={(e) => setAnnualFilterUser(e.target.value)}
                  >
                    <option value="Tutti">Tutti</option>
                    <option value={userName1}>{userName1}</option>
                    <option value={userName2}>{userName2}</option>
                  </select>
                </div>
                {filteredAnnualSpendingData.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full bg-zinc-800 rounded-lg shadow-md">
                      <thead>
                        <tr className="bg-zinc-700 text-gray-300 uppercase text-sm leading-normal">
                          <th className="py-3 px-6 text-left rounded-tl-lg">Anno</th>
                          <th className="py-3 px-6 text-right rounded-tr-lg">Totale Speso (€)</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-200 text-sm font-light">
                        {filteredAnnualSpendingData.map((data, index) => (
                          <tr key={index} className="border-b border-zinc-600 hover:bg-zinc-700">
                            <td className="py-3 px-6 text-left whitespace-nowrap">{data.name}</td>
                            <td className="py-3 px-6 text-right">{data.total.toFixed(2)}€</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center mt-4">Nessuna spesa disponibile per la selezione corrente.</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Historical Spending Section - Now with consistent styling */}
        <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
          >
            {showHistory ? 'Nascondi Storico Spese Dettagliato' : 'Mostra Storico Spese Dettagliato'}
          </button>
          {showHistory && (
            <div className="mt-4"> 
              <h3 className="text-xl font-semibold text-purple-300 mb-4">Storico Spese Dettagliato</h3>
              <div className="mt-4 mb-2">
                <label htmlFor="historyFilterUser" className="block text-gray-300 text-sm font-medium mb-1">Filtra per utente:</label>
                <select
                  id="historyFilterUser"
                  className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                  value={historyFilterUser}
                  onChange={(e) => setHistoryFilterUser(e.target.value)}
                >
                  <option value="Tutti">Tutti</option>
                  <option value={userName1}>{userName1}</option>
                  <option value={userName2}>{userName2}</option>
                </select>
              </div>
              {filteredHistoricalData.length > 0 ? (
                <div className="space-y-4">
                  {filteredHistoricalData.map(yearData => (
                    <div key={yearData.name} className="bg-zinc-600 p-4 rounded-lg shadow-sm">
                      <h4 className="text-lg font-bold text-gray-100 mb-2">{yearData.name}: {yearData.total.toFixed(2)}€</h4>
                      <ul className="list-disc list-inside text-gray-300 ml-4 space-y-2"> 
                        {yearData.months.map(monthData => (
                          <li key={monthData.name}>
                            <p className="font-semibold text-gray-100">{getMonthName(monthData.name)}: {monthData.total.toFixed(2)}€</p>
                            <ul className="list-circle list-inside text-gray-400 ml-4 space-y-1"> 
                              {monthData.expenses.map(expense => (
                                <li key={expense.id} className="text-sm">
                                  {expense.description} - {expense.amount.toFixed(2)}€ (pagato da {expense.paidBy})
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center">Nessuno storico disponibile per la selezione corrente. Aggiungi spese.</p>
              )}
            </div>
          )}
        </div>

        {/* Expense List - Now with consistent styling */}
        <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
          <button
            onClick={() => setShowRecentExpenses(!showRecentExpenses)}
            className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
          >
            {showRecentExpenses ? 'Nascondi Spese Recenti' : 'Mostra Spese Recenti'}
          </button>
          {showRecentExpenses && (
            <div className="mt-4"> 
              <h2 className="text-2xl font-semibold text-purple-300 mb-4">Spese Recenti</h2>
              {expenses.length === 0 ? (
                <p className="text-gray-400 text-center">Nessuna spesa aggiunta ancora.</p>
              ) : (
                <div className="space-y-3">
                  {expenses.map(expense => (
                    <div key={expense.id} className="flex justify-between items-center bg-zinc-800 p-4 rounded-lg shadow-sm">
                      <div>
                        <p className="text-lg font-medium text-gray-100">{expense.description}</p>
                        <p className="text-sm text-gray-400">
                          <span className="font-semibold">{expense.paidBy}</span> ha pagato &bull; {expense.category}
                        </p>
                        <p className="text-xs text-gray-500">
                          {expense.timestamp && new Date(expense.timestamp.toDate()).toLocaleString('it-IT')}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3">
                        <p className="text-xl font-bold text-emerald-300">{expense.amount.toFixed(2)}€</p>
                        <button
                          onClick={() => confirmDeleteExpense(expense.id)}
                          className="text-red-400 hover:text-red-500 p-2 rounded-full transition duration-200"
                          aria-label="Elimina spesa"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Settings Section */}
        <div className="mt-8 pt-6 border-t border-zinc-700">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full bg-zinc-700 hover:bg-zinc-600 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
          >
            {showSettings ? 'Nascondi Impostazioni' : 'Mostra Impostazioni'}
          </button>
          {showSettings && (
            <div className="mt-4 p-4 bg-zinc-700 rounded-lg shadow-inner">
              <h3 className="text-xl font-semibold text-purple-300 mb-4">Nomi Utenti</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="userName1" className="block text-gray-300 text-sm font-medium mb-1">Nome Utente 1</label>
                  <input
                    type="text"
                    id="userName1"
                    className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                    value={userName1}
                    onChange={(e) => setUserName1(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="userName2" className="block text-gray-300 text-sm font-medium mb-1">Nome Utente 2</label>
                  <input
                    type="text"
                    id="userName2"
                    className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                    value={userName2}
                    onChange={(e) => setUserName2(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-gray-400 text-sm mt-4">
                I nomi utente vengono utilizzati per i calcoli del saldo.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-800 rounded-lg p-6 w-full max-w-sm shadow-xl border border-zinc-700">
            <h3 className="text-xl font-semibold text-red-400 mb-4">Conferma Eliminazione</h3>
            <p className="text-gray-200 mb-6">Sei sicuro di voler eliminare questa spesa?</p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="bg-zinc-600 hover:bg-zinc-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
              >
                Annulla
              </button>
              <button
                onClick={deleteExpense}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
