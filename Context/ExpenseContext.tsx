import React, { createContext, useCallback, useState } from "react";
import { Expense } from "../types/expense";
import {
  DEFAULT_CURRENCY,
  convertFromINR as convertFromINRValue,
  convertToINR as convertToINRValue,
  formatCurrencyAmount,
  normalizeCurrencyCode,
} from "../constants/currency";

export { SUPPORTED_CURRENCIES } from "../constants/currency";

interface ExpenseContextType {
  expenses: Expense[];
  budget: number;
  isDarkMode: boolean;
  currency: string;
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

  const setCurrency = useCallback((value: string) => {
    setCurrencyState(normalizeCurrencyCode(value));
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
