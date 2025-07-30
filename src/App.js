import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, // Mantenuto per riferimento, ma non usato nell'interfaccia
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query, setDoc } from 'firebase/firestore'; // Aggiunto setDoc

// ********************************************************************************
// * PASSO FONDAMENTALE: SOSTITUISCI QUESTI VALORI CON I TUOI DATI REALI DI FIREBASE *
// ********************************************************************************

// 1. Configurazione Firebase (firebaseConfig):
// Questi sono i dettagli specifici del tuo progetto Firebase.
// PER TROVARLI:
//   a. Vai alla Console Firebase: https://console.firebase.google.com/
//   b. Seleziona il tuo progetto Firebase.
//   c. Clicca sull'icona a forma di ingranaggio (Impostazioni progetto) accanto a "Panoramica del progetto".
//   d. Scorri verso il basso fino alla sezione "Le tue app".
//   e. Seleziona la tua app web (icona con "</>"). Se non hai un'app web, clicca su "Aggiungi app" e scegli l'icona web.
//   f. Ti verrà mostrato un oggetto JavaScript simile a quello qui sotto.
//      COPIA I VALORI ESATTI (tra virgolette) e incollali qui.

const firebaseConfig = {
  apiKey: "AIzaSyAdjX8SY1xZPsdJmad8CH-nhKNsFUaMKPw",             // <-- INSERISCI QUI LA TUA API KEY (es. "AIzaSyC...")
  authDomain: "spese-famiglia-casetta.firebaseapp.com",     // <-- INSERISCI QUI IL TUO AUTH DOMAIN (es. "tuo-progetto.firebaseapp.com")
  projectId: "spese-famiglia-casetta",       // <-- INSERISCI QUI IL TUO PROJECT ID (es. "tuo-progetto-12345")
  storageBucket: "spese-famiglia-casetta.firebasestorage.app", // <-- INSERISCI QUI IL TUO STORAGE BUCKET (es. "tuo-progetto-12345.appspot.com")
  messagingSenderId: "1033593588036", // <-- INSERISCI QUI IL TUO MESSAGING SENDER ID
  appId: "1:1033593588036:web:9aa23004bb8751458b2f11"    // <-- INSERISCI QUI L'APP ID SPECIFICO DI FIREBASE (es. "1:234567890:web:abcdef12345")
};

// 2. ID Logico dell'Applicazione (appId):
// Questa è una stringa che scegli tu per identificare la TUA app all'interno della struttura di Firestore.
// È il "nome" della collezione principale dove verranno salvate le spese.
// Deve essere una stringa UNICA e SIGNIFICATIVA per la tua famiglia (es. 'spese-famiglia-rossi', 'budget-mariogiovanna').
// Non deve essere uguale all'appId di Firebase sopra, anche se puoi usare lo stesso valore se vuoi.
const appId = 'spese-famiglia-casetta'; // <-- INSERISCI QUI IL TUO ID LOGICO UNICO (es. 'spese-famiglia-rossi')

// ********************************************************************************
// * FINE DELLE SOSTITUZIONI NECESSARIE *
// ********************************************************************************


function App() {
  const [db, setDb] = useState(null);
  const [user, setUser] = useState(null); // Stato per l'utente autenticato di Firebase
  const [userId, setUserId] = useState(null); // ID dell'utente (user.uid)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  // Initialize Firebase and set up auth listener
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const firestoreDb = getFirestore(app);
    const firebaseAuth = getAuth(app);

    setDb(firestoreDb);

    // Listener per i cambiamenti dello stato di autenticazione
    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setUserId(currentUser.uid);
        console.log("Authenticated with userId:", currentUser.uid);
      } else {
        setUserId(null); // Nessun utente autenticato
        console.log("No user is signed in.");
      }
      setLoading(false);
    });

    return () => unsubscribeAuth(); // Cleanup listener on component unmount
  }, []);

  // Fetch expenses from Firestore (only if user is authenticated)
  useEffect(() => {
    if (!db || !userId) {
      setExpenses([]); // Clear expenses if not authenticated
      console.log("Firestore or userId not ready for fetching expenses, or user not authenticated.");
      return;
    }

    console.log("Fetching expenses for userId:", userId);
    // NUOVO PERCORSO: artifacts/{appId}/users/{userId}/expenses
    const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
    const q = query(expensesCollectionRef);

    const unsubscribeFirestore = onSnapshot(q, (snapshot) => {
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

    // Rimosso 'appId' dall'array di dipendenze.
    // 'appId' è una costante definita fuori dal componente e non cambierà,
    // quindi non è necessario includerla qui.
    return () => unsubscribeFirestore();
  }, [db, userId]); 

  // New useEffect to load and save couple names from Firestore
  useEffect(() => {
    if (!db || !userId) { // Load settings only if DB is ready and user is authenticated
      return;
    }

    const settingsDocRef = doc(db, `artifacts/${appId}/settings/couple_names`);

    const unsubscribeSettings = onSnapshot(settingsDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserName1(data.user1Name || 'Io');
        setUserName2(data.user2Name || 'La mia ragazza');
        console.log("Couple names loaded from Firestore:", data);
      } else {
        // If document doesn't exist, save default names
        console.log("Couple names document not found, saving defaults.");
        setDoc(settingsDocRef, {
          user1Name: userName1,
          user2Name: userName2
        }, { merge: true }).catch(e => console.error("Error saving default couple names:", e));
      }
    }, (err) => {
      console.error("Error fetching couple names settings:", err);
      setError("Errore nel caricamento dei nomi della coppia. Riprova.");
    });

    return () => unsubscribeSettings();
  }, [db, userId, appId]); // Depend on db, userId, and appId

  // Function to save couple names to Firestore
  const saveCoupleNames = useCallback(async () => {
    if (!db || !userId) {
      setError("Database non disponibile o utente non autenticato.");
      return;
    }
    try {
      setLoading(true);
      const settingsDocRef = doc(db, `artifacts/${appId}/settings/couple_names`);
      await setDoc(settingsDocRef, {
        user1Name: userName1,
        user2Name: userName2
      }, { merge: true }); // 'merge: true' per non sovrascrivere altri campi se presenti
      setError(null);
      console.log("Couple names saved successfully.");
    } catch (e) {
      console.error("Error saving couple names: ", e);
      setError("Errore nel salvataggio dei nomi della coppia. Riprova.");
    } finally {
      setLoading(false);
    }
  }, [db, userId, appId, userName1, userName2]); // Dipendenze per useCallback

  // Call saveCoupleNames whenever userName1 or userName2 change
  useEffect(() => {
    if (db && userId) { // Only save if DB is ready and user is authenticated
      const handler = setTimeout(() => {
        saveCoupleNames();
      }, 500); // Debounce per evitare scritture eccessive
      return () => clearTimeout(handler);
    }
  }, [userName1, userName2, db, userId, saveCoupleNames]); // Aggiunto saveCoupleNames alle dipendenze


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
    if (!db || !userId) {
      setError("Database non disponibile o utente non autenticato.");
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
      const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
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
    setShowLlmInsight(true); // Always show section when generating

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
      const apiKey = ""; // If you want to use models other than gemini-2.5-flash-preview-05-20 or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
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
    if (!db || !userId || !description || !amount || isNaN(parseFloat(amount))) {
      setError("Per favor, inserisci una descrizione e un importo valido, e assicurati di essere autenticato.");
      return;
    }

    try {
      setLoading(true);
      const expensesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/expenses`);
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
    if (!db || !userId || !expenseToDelete) {
      setError("Database non disponibile, utente non autenticato o spesa non selezionata.");
      return;
    }

    try {
      setLoading(true);
      await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/expenses`, expenseToDelete));
      setError(null);
      console.log("Expense deleted successfully.");
    } catch (e) {
      console.error("Error deleting document: ", e);
      setError("Errore nell'eli
