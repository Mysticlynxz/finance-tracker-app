import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useEffect, useState } from "react";
import { Expense } from "../types/expense";
import {
  DEFAULT_CURRENCY,
  convertFromINR as convertFromINRValue,
  convertToINR as convertToINRValue,
  formatCurrencyAmount,
  normalizeCurrencyCode,
} from "../constants/currency";

export { SUPPORTED_CURRENCIES } from "../constants/currency";

const CURRENCY_STORAGE_KEY = "@finance-tracker/currency";

interface ExpenseContextType {
  expenses: Expense[];
  budget: number;
  isDarkMode: boolean;
  currency: string;
  /** True only after the saved currency preference has finished loading from storage. */
  isCurrencyReady: boolean;
  addExpense: (amountInINR: number, category: string) => void;
  setBudget: (amountInINR: number) => void;
  setCurrency: (value: string) => void;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  clearExpenses: () => void;
  convertFromINR: (amountInINR: number) => number;
  convertToINR: (amountInSelectedCurrency: number) => number;
  formatAmount: (amountInINR: number) => string;
}

export const ExpenseContext = createContext<ExpenseContextType>(
  {} as ExpenseContextType
);

interface ExpenseProviderProps {
  children: React.ReactNode;
}

export const ExpenseProvider = ({ children }: ExpenseProviderProps) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budget, setBudgetAmount] = useState<number>(0);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [currency, setCurrencyState] = useState<string>(DEFAULT_CURRENCY);
  // True only after AsyncStorage hydration completes (or fails).
  const [isCurrencyReady, setIsCurrencyReady] = useState<boolean>(false);
  // Track the latest user-set currency so late hydration does not overwrite it.
  const latestUserCurrencyRef = React.useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadCurrency = async () => {
      try {
        const stored = await AsyncStorage.getItem(CURRENCY_STORAGE_KEY);
        if (isMounted) {
          // Only apply stored value if the user hasn't already changed currency.
          if (latestUserCurrencyRef.current === null && stored) {
            const normalized = normalizeCurrencyCode(stored);
            setCurrencyState(normalized);
          }
        }
      } catch (error) {
        console.error("[ExpenseContext] Failed to load currency:", error);
      } finally {
        if (isMounted) {
          setIsCurrencyReady(true);
        }
      }
    };

    void loadCurrency();

    return () => {
      isMounted = false;
    };
  }, []);

  const setCurrency = useCallback(async (value: string) => {
    const normalized = normalizeCurrencyCode(value);
    latestUserCurrencyRef.current = normalized;
    setCurrencyState(normalized);
    try {
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, normalized);
    } catch (error) {
      console.error("[ExpenseContext] Failed to save currency:", error);
    }
  }, []);

  const convertFromINR = useCallback(
    (amountInINR: number) => convertFromINRValue(amountInINR, currency),
    [currency]
  );

  const convertToINR = useCallback(
    (amountInSelectedCurrency: number) =>
      convertToINRValue(amountInSelectedCurrency, currency),
    [currency]
  );

  const formatAmount = useCallback(
    (amountInINR: number) =>
      formatCurrencyAmount(convertFromINRValue(amountInINR, currency), currency),
    [currency]
  );

  const addExpense = (amountInINR: number, category: string) => {
    const normalizedAmount =
      Number.isFinite(amountInINR) && amountInINR > 0 ? Number(amountInINR) : 0;

    const newExpense: Expense = {
      id: Date.now().toString(),
      amount: normalizedAmount,
      category,
      date: new Date().toISOString(),
    };

    setExpenses((currentExpenses) => [...currentExpenses, newExpense]);
  };

  const clearExpenses = () => {
    setExpenses([]);
  };

  const setBudget = (amountInINR: number) => {
    const normalizedAmount =
      Number.isFinite(amountInINR) && amountInINR > 0 ? Number(amountInINR) : 0;
    setBudgetAmount(normalizedAmount);
  };

  return (
    <ExpenseContext.Provider
      value={{
        expenses,
        addExpense,
        budget,
        setBudget,
        clearExpenses,
        isDarkMode,
        setIsDarkMode,
        currency,
        isCurrencyReady,
        setCurrency,
        convertFromINR,
        convertToINR,
        formatAmount,
      }}
    >
      {children}
    </ExpenseContext.Provider>
  );
};
