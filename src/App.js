import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  // createUserWithEmailAndPassword, // Rimosso perché la funzione handleSignUp non è più utilizzata
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query, setDoc } from 'firebase/firestore'; 
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


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

// Costanti per i nomi utente predefiniti
const DEFAULT_USER1_NAME = 'Io';
const DEFAULT_USER2_NAME = 'La mia ragazza';
const SETTLEMENT_CATEGORY = 'Saldo Ripianato'; // Nuova costante per la categoria di ripianamento

// Helper function to get the actual payer name for calculation purposes
// Questa funzione è ora definita al di fuori del componente App per evitare problemi di dipendenza.
// Non ha bisogno di useCallback perché non è una prop o uno stato del componente.
const getActualPayerForCalculation = (paidByValue, currentUserName1, currentUserName2) => {
  if (paidByValue === currentUserName1) return currentUserName1;
  if (paidByValue === currentUserName2) return currentUserName2;
  if (paidByValue === DEFAULT_USER1_NAME && currentUserName1 !== DEFAULT_USER1_NAME) return currentUserName1;
  if (paidByValue === DEFAULT_USER2_NAME && currentUserName2 !== DEFAULT_USER2_NAME) return currentUserName2;
  return paidByValue;
};


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
  const [userName1, setUserName1] = useState(DEFAULT_USER1_NAME);
  const [userName2, setUserName2] = useState(DEFAULT_USER2_NAME);
  // Nuovi stati locali per la modifica dei nomi utente
  const [editingUserName1, setEditingUserName1] = useState(DEFAULT_USER1_NAME);
  const [editingUserName2, setEditingUserName2] = useState(DEFAULT_USER2_NAME);

  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const [showHistory, setShowHistory] = useState(false); 
  const [showMonthlyTable, setShowMonthlyTable] = useState(false);
  const [showAnnualTable, setShowAnnualTable] = useState(false);
  const [showRecentExpenses, setShowRecentExpenses] = useState(false); // Rinominato in "Transazioni Recenti"

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
  const [llmError, setErrorLlm] = useState(null); // Rinominato per evitare conflitto con setError generale
  const [showLlmInsight, setShowLlmInsight] = useState(false); // State to toggle LLM insight visibility

  // Stati per la gestione dell'espansione/collasso nello storico dettagliato
  const [expandedYears, setExpandedYears] = useState(new Set());
  const [expandedMonths, setExpandedMonths] = useState(new Set());

  // Stati per l'inserimento manuale di mese e anno per le spese
  const today = new Date();
  const defaultExpenseDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [expenseDate, setExpenseDate] = useState(defaultExpenseDate);

  // Funzioni per il toggle dell'espansione
  const toggleYear = (year) => {
    setExpandedYears(prev => {
      const newSet = new Set(prev);
      if (newSet.has(year)) {
        newSet.delete(year);
      } else {
        newSet.add(year);
      }
      return newSet;
    });
  };

  const toggleMonth = (monthYear) => {
    setExpandedMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(monthYear)) {
        newSet.delete(monthYear);
      } else {
        newSet.add(monthYear);
      }
      return newSet;
    });
  };

  // Helper per identificare le spese di ripianamento
  const isSettlementExpense = useCallback((expense) => {
    return expense.category === SETTLEMENT_CATEGORY;
  }, []);

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
    try { // Aggiunto blocco try-catch per la gestione degli errori di inizializzazione
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
        setLoading(false); // Imposta loading a false una volta determinato lo stato di autenticazione
      });

      return () => unsubscribeAuth(); // Cleanup listener on component unmount
    } catch (e) {
      console.error("Error initializing Firebase:", e);
      setError(`Errore durante l'inizializzazione di Firebase: ${e.message}. Controlla la tua configurazione di Firebase.`);
      setLoading(false); // Assicurati che loading sia false anche in caso di errore di inizializzazione
    }
  }, []);

  // Fetch expenses from Firestore (only if user is authenticated)
  useEffect(() => {
    if (!db || !userId) {
      setExpenses([]); // Clear expenses if not authenticated
      console.log("Firestore or userId not ready for fetching expenses, or user not authenticated.");
      return;
    }

    console.log("Fetching expenses for userId:", userId);
    // MODIFICA QUI: Ora le spese vengono lette da una collezione pubblica/condivisa
    const expensesCollectionRef = collection(db, `artifacts/${appId}/public/expenses`);
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

    return () => unsubscribeFirestore();
  }, [db, userId]); 

  // New useEffect to load couple names from Firestore
  useEffect(() => {
    if (!db || !userId) { 
      return;
    }

    // Anche i nomi della coppia sono ora in una collezione condivisa (non per utente specifico)
    const settingsDocRef = doc(db, `artifacts/${appId}/settings/couple_names`);

    const unsubscribeSettings = onSnapshot(settingsDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserName1(data.user1Name || DEFAULT_USER1_NAME);
        setUserName2(data.user2Name || DEFAULT_USER2_NAME);
        // Aggiorna anche gli stati di editing quando i nomi globali cambiano (es. caricamento iniziale o aggiornamento da altro utente)
        setEditingUserName1(data.user1Name || DEFAULT_USER1_NAME);
        setEditingUserName2(data.user2Name || DEFAULT_USER2_NAME);
        console.log("Couple names loaded from Firestore:", data);
      } else {
        console.log("Couple names document not found.");
      }
    }, (err) => {
      console.error("Error fetching couple names settings:", err);
      setError("Errore nel caricamento dei nomi della coppia. Riprova.");
    });

    return () => unsubscribeSettings();
  }, [db, userId]); 

  // Function to save couple names to Firestore
  const saveCoupleNames = useCallback(async () => { 
    if (!db || !userId) {
      setError("Database non disponibile o utente non autenticato."); 
      return;
    }
    try {
      setLoading(true); 
      // Anche il salvataggio dei nomi della coppia è ora nella collezione condivisa
      const settingsDocRef = doc(db, `artifacts/${appId}/settings/couple_names`);
      await setDoc(settingsDocRef, {
        user1Name: editingUserName1, 
        user2Name: editingUserName2  
      }, { merge: true }); 
      setError(null); 
      console.log("Couple names saved successfully.");
    } catch (e) {
      console.error("Error saving couple names: ", e);
      setError("Errore nel salvataggio dei nomi della coppia. Riprova.");
    } finally {
      setLoading(false); 
    }
  }, [db, userId, editingUserName1, editingUserName2]); 

  // Process overall spending data (perpetual, monthly/annual averages, and by category)
  useEffect(() => {
    const processOverallSpendingData = () => {
      let totalSum = 0;
      const uniqueMonths = new Set();
      const uniqueYears = new Set();
      const categoryTotals = {}; 

      expenses.forEach(expense => {
        // Escludi le spese di ripianamento dai totali e dalle medie complessive
        if (isSettlementExpense(expense)) {
          return; 
        }

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
  }, [expenses, isSettlementExpense]); 

  // Derived data for Monthly Spending Chart (filtered by monthlyFilterUser)
  const filteredMonthlySpendingData = useMemo(() => {
    const monthlyTotals = {};
    const filteredExpenses = expenses.filter(expense => {
      // Exclude settlement expenses AND apply user filter
      return !isSettlementExpense(expense) &&
             (monthlyFilterUser === 'Tutti' || getActualPayerForCalculation(expense.paidBy, userName1, userName2) === monthlyFilterUser);
    });

    filteredExpenses.forEach(expense => {
      const date = expense.timestamp?.toDate();
      if (date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        monthlyTotals[monthYear] = (monthlyTotals[monthYear] || 0) + expense.amount;
      }
    });

    const dataPoints = Object.keys(monthlyTotals)
      .sort()
      .map(key => ({ name: key, total: monthlyTotals[key] }));

    // Calculate average for the *filtered* monthly data
    const totalSumOfFilteredMonths = dataPoints.reduce((acc, curr) => acc + curr.total, 0);
    const averageOfFilteredMonths = dataPoints.length > 0 ? totalSumOfFilteredMonths / dataPoints.length : 0;

    return dataPoints.map(item => ({
      ...item,
      average: averageOfFilteredMonths // Add the calculated average to each data point
    }));
  }, [expenses, monthlyFilterUser, userName1, userName2, isSettlementExpense]);

  // Derived data for Annual Spending Chart (filtered by annualFilterUser)
  const filteredAnnualSpendingData = useMemo(() => {
    const annualTotals = {};
    const filteredExpenses = expenses.filter(expense => {
      // Exclude settlement expenses AND apply user filter
      return !isSettlementExpense(expense) &&
             (annualFilterUser === 'Tutti' || getActualPayerForCalculation(expense.paidBy, userName1, userName2) === annualFilterUser);
    });

    filteredExpenses.forEach(expense => {
      const date = expense.timestamp?.toDate();
      if (date) {
        const year = date.getFullYear();
        annualTotals[year] = (annualTotals[year] || 0) + expense.amount;
      }
    });

    const dataPoints = Object.keys(annualTotals)
      .sort()
      .map(key => ({ name: key, total: annualTotals[key] }));

    // Calculate average for the *filtered* annual data
    const totalSumOfFilteredYears = dataPoints.reduce((acc, curr) => acc + curr.total, 0);
    const averageOfFilteredYears = dataPoints.length > 0 ? totalSumOfFilteredYears / dataPoints.length : 0;

    return dataPoints.map(item => ({
      ...item,
      average: averageOfFilteredYears // Add the calculated average to each data point
    }));
  }, [expenses, annualFilterUser, userName1, userName2, isSettlementExpense]);

  // Derived data for Historical Spending Section (filtered by historyFilterUser)
  const filteredHistoricalData = useMemo(() => {
    const annualDataMap = {};
    expenses.forEach(expense => {
      // Escludi le spese di ripianamento dallo storico dettagliato
      if (isSettlementExpense(expense)) {
        return;
      }

      const date = expense.timestamp?.toDate();
      if (date && (historyFilterUser === 'Tutti' || getActualPayerForCalculation(expense.paidBy, userName1, userName2) === historyFilterUser)) {
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
  }, [expenses, historyFilterUser, userName1, userName2, isSettlementExpense]); 


  // Calculate balance for current period
  const calculateBalance = useCallback(() => {
    let totalPaidBy1Shared = 0; // Only non-settlement expenses paid by user1
    let totalOverallSharedExpenses = 0; // Sum of all non-settlement expenses

    let totalSettlementFromUser1ToUser2 = 0; // Sum of amounts user1 paid user2 in settlements
    let totalSettlementFromUser2ToUser1 = 0; // Sum of amounts user2 paid user1 in settlements

    expenses.forEach(expense => {
      const actualPayer = getActualPayerForCalculation(expense.paidBy, userName1, userName2);

      if (!isSettlementExpense(expense)) {
        // Normal expenses
        totalOverallSharedExpenses += expense.amount;
        if (actualPayer === userName1) {
          totalPaidBy1Shared += expense.amount;
        } 
      } else {
        // Settlement expenses
        if (actualPayer === userName1) { // User1 paid User2 for settlement
          totalSettlementFromUser1ToUser2 += expense.amount;
        } else if (actualPayer === userName2) { // User2 paid User1 for settlement
          totalSettlementFromUser2ToUser1 += expense.amount;
        }
      }
    });

    const sharePerPerson = totalOverallSharedExpenses / 2;

    // Calculate initial net balance based on shared expenses
    let user1Net = totalPaidBy1Shared - sharePerPerson;

    // Now, apply the net effect of all settlement transactions
    // If User1 paid User2 for settlement, User1's debt reduces (or credit increases).
    // So user1Net should INCREASE.
    user1Net += totalSettlementFromUser1ToUser2;
    // If User2 paid User1 for settlement, User1's debt increases (or credit decreases).
    // So user1Net should DECREASE.
    user1Net -= totalSettlementFromUser2ToUser1;


    let summary = 'Siete in pari!';
    if (Math.abs(user1Net) < 0.01) {
        summary = 'Siete in pari!';
    } else if (user1Net > 0) {
        summary = `${userName2} deve dare ${userName1} ${Math.abs(user1Net).toFixed(2)}€`;
    } else { // user1Net < 0
        summary = `${userName1} deve dare ${userName2} ${Math.abs(user1Net).toFixed(2)}€`;
    }

    return {
      netBalance: user1Net,
      summary: summary
    };
  }, [expenses, userName1, userName2, isSettlementExpense]); 

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

    // Il ripianamento del saldo dovrebbe usare i nomi attuali
    if (netBalance > 0) { 
      payer = userName2;
      description = `Ripianamento saldo da ${userName2} a ${userName1}`;
    } else { // netBalance < 0
      payer = userName1;
      description = `Ripianamento saldo da ${userName1} a ${userName2}`;
    }

    try {
      setLoading(true);
      // MODIFICA QUI: La transazione di ripianamento va nella collezione pubblica
      const expensesCollectionRef = collection(db, `artifacts/${appId}/public/expenses`);
      await addDoc(expensesCollectionRef, {
        description: description,
        amount: settlementAmount,
        paidBy: payer, // Salva il nome corrente per il ripianamento
        category: SETTLEMENT_CATEGORY, // Usa la costante per la categoria
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
    setErrorLlm(null); 
    setLlmInsight(null);
    setShowLlmInsight(true); 

    const spendingDataSummary = {
      perpetualTotal: perpetualTotal.toFixed(2),
      monthlyAverage: monthlyAverage.toFixed(2),
      annualAverage: annualAverage.toFixed(2),
      spendingByCategory: Object.entries(spendingByCategory).map(([cat, val]) => ({ category: cat, total: val.toFixed(2) })),
      // Per i prompt LLM, usiamo i dati aggregati globali (non filtrati per utente)
      monthlyTrends: filteredMonthlySpendingData.map(data => ({ month: `${getMonthName(parseInt(data.name.split('-')[1]))} ${data.name.split('-')[0]}`, total: data.total.toFixed(2) })),
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
        setErrorLlm("Nessun consiglio generato. Riprova."); 
      }
    } catch (e) {
      console.error("Error calling Gemini API:", e);
      setErrorLlm("Errore nella generazione dei consigli. Riprova."); 
    } finally {
      setLlmLoading(false);
    }
  };

  // Add a new expense
  const addExpense = async () => {
    if (!db || !userId || !description || !amount || isNaN(parseFloat(amount)) || !expenseDate) {
      setError("Per favor, inserisci una descrizione, un importo valido e una data, e assicurati di essere autenticato.");
      return;
    }

    try {
      setLoading(true);
      // MODIFICA QUI: Le spese vengono aggiunte alla collezione pubblica
      const expensesCollectionRef = collection(db, `artifacts/${appId}/public/expenses`);
      await addDoc(expensesCollectionRef, {
        description,
        amount: parseFloat(amount),
        paidBy,
        category,
        timestamp: new Date(expenseDate) // Usa la data selezionata dal campo input
      });
      setDescription('');
      setAmount('');
      setExpenseDate(defaultExpenseDate); // Reimposta alla data corrente dopo l'aggiunta
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
      // MODIFICA QUI: Le spese vengono eliminate dalla collezione pubblica
      await deleteDoc(doc(db, `artifacts/${appId}/public/expenses`, expenseToDelete));
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

  // Handle user sign-in
  const handleSignIn = async () => {
    if (!email || !password) {
      setError("Per favor, inserisci email e password.");
      return;
    }
    try {
      setLoading(true);
      const authInstance = getAuth();
      await signInWithEmailAndPassword(authInstance, email, password);
      setError(null);
      // L'onAuthStateChanged gestirà l'aggiornamento dello stato 'user'
    } catch (e) {
      console.error("Error signing in:", e);
      setError(`Errore durante l'accesso: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle user sign-out
  const handleSignOut = async () => {
    try {
      setLoading(true);
      const authInstance = getAuth();
      await signOut(authInstance);
      setError(null);
      // L'onAuthStateChanged gestirà l'aggiornamento dello stato 'user'
    } catch (e) {
      console.error("Error signing out:", e);
      setError(`Errore durante il logout: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Categories and Payer options
  const categories = ['Casa', 'Cibo', 'Svago', 'Trasporti', 'Salute', 'Altro', SETTLEMENT_CATEGORY]; 

  // Helper to format month name
  const getMonthName = (monthNumber) => {
    const date = new Date();
    date.setMonth(monthNumber - 1); // Imposta il mese (0-based)
    return date.toLocaleString('it-IT', { month: 'long' });
  };

  // Helper function to get the display name for 'paidBy'
  const getDisplayName = useCallback((paidByValue) => {
    if (paidByValue === DEFAULT_USER1_NAME) {
      return userName1;
    } else if (paidByValue === DEFAULT_USER2_NAME) {
      return userName2;
    }
    return paidByValue; 
  }, [userName1, userName2]); 

  // useEffect per aggiungere la favicon
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>%24</text></svg>';
    document.head.appendChild(link);

    return () => {
      document.head.removeChild(link);
    };
  }, []); // Esegui solo una volta al montaggio

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-gray-100">
        <div className="text-xl animate-pulse">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-gray-100 font-inter p-4 sm:p-6 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl bg-zinc-800 rounded-xl shadow-lg p-6 sm:p-8 md:p-10 mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-purple-400 mb-4 text-center">
          Gestione Spese Casetta
        </h1>
        <p className="text-gray-400 text-center mb-6">
          {user ? `Benvenuto, ${user.email}!` : "Accedi per gestire le tue spese."}
          {user && <span className="font-mono text-sm break-all block mt-2">ID Utente: {userId}</span>}
        </p>

        {error && (
          <div className="bg-red-700 text-white p-3 rounded-lg mb-4 text-center">
            {error}
          </div>
        )}

        {!user ? ( // Mostra la schermata di login/registrazione se l'utente non è autenticato
          <div className="bg-zinc-700 p-6 rounded-lg shadow-inner mb-8">
            <h2 className="text-2xl font-semibold text-purple-300 mb-4 text-center">Accedi</h2>
            <div className="mb-4">
              <label htmlFor="email" className="block text-gray-300 text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                id="email"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="la.tua.email@esempio.com"
              />
            </div>
            <div className="mb-6">
              <label htmlFor="password" className="block text-gray-300 text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                id="password"
                className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimo 6 caratteri"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleSignIn}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
              >
                Accedi
              </button>
              {/* Pulsante Registrati rimosso */}
            </div>
          </div>
        ) : ( // Mostra il contenuto dell'app se l'utente è autenticato
          <>
            <button
              onClick={handleSignOut}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg mb-6"
            >
              Esci
            </button>

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
                {/* Nuovo campo per la Data */}
                <div className="col-span-1 sm:col-span-2"> {/* Occupa tutta la larghezza su mobile, metà su desktop */}
                  <label htmlFor="expenseDate" className="block text-gray-300 text-sm font-medium mb-1">Data Spesa</label>
                  <input
                    type="date"
                    id="expenseDate"
                    className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                  />
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

            {/* Spending Trends Charts */}
            <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
              <h2 className="text-2xl font-semibold text-purple-300 mb-4">Andamento Spese</h2>

              {/* Monthly Spending Chart */}
              <div className="mb-6">
                <button
                  onClick={() => setShowMonthlyTable(!showMonthlyTable)}
                  className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
                >
                  {showMonthlyTable ? 'Nascondi Grafico Mensile' : 'Mostra Grafico Mensile'}
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
                        <option value={userName1}>{userName1}</option>
                        <option value={userName2}>{userName2}</option>
                        <option value="Tutti">Tutti</option>
                      </select>
                    </div>
                    {filteredMonthlySpendingData.length > 0 ? (
                      <div className="mt-4" style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                          <LineChart
                            data={filteredMonthlySpendingData}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#4a4a4a" />
                            <XAxis
                              dataKey="name"
                              tickFormatter={(tick) => getMonthName(parseInt(tick.split('-')[1])) + ' ' + tick.split('-')[0]}
                              stroke="#ccc"
                              tick={{ fill: '#ccc' }}
                            />
                            <YAxis stroke="#ccc" tick={{ fill: '#ccc' }} />
                            <Tooltip
                              formatter={(value, name) => [`${value.toFixed(2)}€`, name === 'total' ? 'Spesa Totale' : 'Media']}
                              labelFormatter={(label) => getMonthName(parseInt(label.split('-')[1])) + ' ' + label.split('-')[0]}
                              contentStyle={{ backgroundColor: '#333', border: 'none', borderRadius: '8px' }}
                              itemStyle={{ color: '#fff' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '10px', color: '#ccc' }} />
                            <Line type="monotone" dataKey="total" stroke="#8884d8" activeDot={{ r: 8 }} name="Spesa Mensile" />
                            <Line type="monotone" dataKey="average" stroke="#82ca9d" name="Media Mensile" dot={false} strokeDasharray="5 5" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-center mt-4">Nessuna spesa disponibile per la selezione corrente.</p>
                    )}
                  </>
                )}
              </div>

              {/* Annual Spending Chart */}
              <div>
                <button
                  onClick={() => setShowAnnualTable(!showAnnualTable)}
                  className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
                >
                  {showAnnualTable ? 'Nascondi Grafico Annuale' : 'Mostra Grafico Annuale'}
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
                        <option value={userName1}>{userName1}</option>
                        <option value={userName2}>{userName2}</option>
                        <option value="Tutti">Tutti</option>
                      </select>
                    </div>
                    {filteredAnnualSpendingData.length > 0 ? (
                      <div className="mt-4" style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                          <LineChart
                            data={filteredAnnualSpendingData}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#4a4a4a" />
                            <XAxis dataKey="name" stroke="#ccc" tick={{ fill: '#ccc' }} />
                            <YAxis stroke="#ccc" tick={{ fill: '#ccc' }} />
                            <Tooltip
                              formatter={(value, name) => [`${value.toFixed(2)}€`, name === 'total' ? 'Spesa Totale' : 'Media']}
                              labelFormatter={(label) => `Anno ${label}`}
                              contentStyle={{ backgroundColor: '#333', border: 'none', borderRadius: '8px' }}
                              itemStyle={{ color: '#fff' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '10px', color: '#ccc' }} />
                            <Line type="monotone" dataKey="total" stroke="#8884d8" activeDot={{ r: 8 }} name="Spesa Annuale" />
                            <Line type="monotone" dataKey="average" stroke="#82ca9d" name="Media Annuale" dot={false} strokeDasharray="5 5" />
                          </LineChart>
                        </ResponsiveContainer>
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
                      <option value={userName1}>{userName1}</option>
                      <option value={userName2}>{userName2}</option>
                      <option value="Tutti">Tutti</option>
                    </select>
                  </div>
                  {filteredHistoricalData.length > 0 ? (
                    <div className="space-y-4">
                      {filteredHistoricalData.map(yearData => (
                        <div key={yearData.name} 
                             className="bg-zinc-600 p-4 rounded-lg shadow-sm cursor-pointer hover:bg-zinc-500 transition duration-200"
                             onClick={() => toggleYear(yearData.name)}>
                          <div className="flex justify-between items-center">
                            <h4 className="text-lg font-bold text-gray-100">{yearData.name}: {yearData.total.toFixed(2)}€</h4>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className={`h-5 w-5 text-gray-300 transform transition-transform duration-200 ${
                                expandedYears.has(yearData.name) ? 'rotate-90' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                          {expandedYears.has(yearData.name) && (
                            <ul className="list-none text-gray-300 mt-4 space-y-2"> 
                              {yearData.months.map(monthData => (
                                <li key={monthData.name}
                                    className="bg-zinc-700 p-3 rounded-md cursor-pointer hover:bg-zinc-600 transition duration-200"
                                    onClick={(e) => { e.stopPropagation(); toggleMonth(monthData.name); }}>
                                  <div className="flex justify-between items-center">
                                    <p className="font-semibold text-gray-100">{getMonthName(parseInt(monthData.name.split('-')[1]))}: {monthData.total.toFixed(2)}€</p>
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className={`h-4 w-4 text-gray-400 transform transition-transform duration-200 ${
                                        expandedMonths.has(monthData.name) ? 'rotate-90' : ''
                                      }`}
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>
                                  {expandedMonths.has(monthData.name) && (
                                    <ul className="list-none text-gray-400 mt-2 ml-4 space-y-1"> 
                                      {monthData.expenses.map(expense => (
                                        <li key={expense.id} className="text-sm">
                                          {expense.description} - {expense.amount.toFixed(2)}€ (pagato da {getDisplayName(expense.paidBy)})
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-center">Nessuno storico disponibile per la selezione corrente. Aggiungi spese.</p>
                  )}
                </div>
              )}
            </div>

            {/* Transaction Log Section */}
            <div className="mb-8 p-6 bg-zinc-700 rounded-xl shadow-inner">
              <button
                onClick={() => setShowRecentExpenses(!showRecentExpenses)}
                className="w-full bg-zinc-600 hover:bg-zinc-500 text-gray-200 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
              >
                {showRecentExpenses ? 'Nascondi Transazioni Recenti' : 'Mostra Transazioni Recenti'}
              </button>
              {showRecentExpenses && (
                <div className="mt-4"> 
                  <h2 className="text-2xl font-semibold text-purple-300 mb-4">Transazioni Recenti</h2>
                  {expenses.length === 0 ? (
                    <p className="text-gray-400 text-center">Nessuna transazione aggiunta ancora.</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto space-y-3 pr-2"> {/* Aggiunto max-h e overflow-y */}
                      {expenses.map(expense => (
                        <div key={expense.id} className="flex justify-between items-center bg-zinc-800 p-4 rounded-lg shadow-sm">
                          <div>
                            <p className="text-lg font-medium text-gray-100">{expense.description}</p>
                            <p className="text-sm text-gray-400">
                              <span className="font-semibold">{getDisplayName(expense.paidBy)}</span> ha pagato &bull; {expense.category}
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
                        value={editingUserName1} 
                        onChange={(e) => setEditingUserName1(e.target.value)} 
                      />
                    </div>
                    <div>
                      <label htmlFor="userName2" className="block text-gray-300 text-sm font-medium mb-1">Nome Utente 2</label>
                      <input
                        type="text"
                        id="userName2"
                        className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-700 focus:ring-purple-500 focus:border-purple-500 text-gray-100"
                        value={editingUserName2} 
                        onChange={(e) => setEditingUserName2(e.target.value)} 
                      />
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm mt-4">
                    I nomi utente vengono utilizzati per i calcoli del saldo.
                  </p>
                  <button
                    onClick={saveCoupleNames} 
                    className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
                  >
                    Salva Nomi
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Copyright Footer */}
      <footer className="w-full max-w-3xl text-center text-gray-500 text-xs mt-8 p-4">
        <p>© 2025 App pensata e creata da Andrea 'unbll' Marsili. Tutti i diritti riservati.</p>
      </footer>

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
