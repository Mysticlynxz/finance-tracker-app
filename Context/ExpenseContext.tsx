import React, { createContext, useCallback, useState } from "react";
import { Expense } from "../types/expense";

export const SUPPORTED_CURRENCIES = [
    "INR",
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "CNY",
    "AUD",
    "CAD",
    "CHF",
    "SGD",
    "AED",
    "SAR",
] as const;

const CURRENCY_SYMBOL_FALLBACKS: Record<string, string> = {
    INR: "\u20B9",
    USD: "$",
    EUR: "\u20AC",
    GBP: "\u00A3",
    JPY: "\u00A5",
    CNY: "\u00A5",
    AUD: "$",
    CAD: "$",
    CHF: "Fr.",
    SGD: "$",
    AED: "\u062F.\u0625",
    SAR: "\uFDFC",
};

interface ExpenseContextType {
    expenses: Expense[];
    budget: number;
    isDarkMode: boolean;
    currency: string;
    addExpense: (amount: number, category: string) => void;
    setBudget: (amount: number) => void;
    setCurrency: (value: string) => void;
    setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
    clearExpenses: () => void;
    formatAmount: (amount: number) => string;
}

export const ExpenseContext = createContext<ExpenseContextType>(
    {} as ExpenseContextType
);

interface ExpenseProviderProps {
    children: React.ReactNode;
}

const resolveCurrencySymbol = (currency: string) => {
    try {
        const parts = new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            currencyDisplay: "narrowSymbol",
            maximumFractionDigits: 2,
        }).formatToParts(0);

        const rawSymbol =
            parts.find((part) => part.type === "currency")?.value ??
            CURRENCY_SYMBOL_FALLBACKS[currency] ??
            "$";

        const symbolWithoutCountryPrefix = rawSymbol.replace(
            /^[A-Za-z]{1,3}(?=\$)/,
            ""
        );

        return (
            symbolWithoutCountryPrefix.trim() ||
            CURRENCY_SYMBOL_FALLBACKS[currency] ||
            "$"
        );
    } catch {
        return CURRENCY_SYMBOL_FALLBACKS[currency] ?? "$";
    }
};

export const ExpenseProvider = ({ children }: ExpenseProviderProps) => {
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [budget, setBudgetAmount] = useState<number>(0);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
    const [currency, setCurrencyState] = useState<string>("INR");

    const setCurrency = useCallback((value: string) => {
        const normalized = value.toUpperCase();
        if (SUPPORTED_CURRENCIES.includes(normalized as (typeof SUPPORTED_CURRENCIES)[number])) {
            setCurrencyState(normalized);
            return;
        }
        setCurrencyState("INR");
    }, []);

    const formatAmount = useCallback(
        (amount: number) => {
            const numericAmount = Number(amount);
            const safeAmount = Number.isFinite(numericAmount) ? numericAmount : 0;
            const currencySymbol = resolveCurrencySymbol(currency);

            console.log("Displaying amount:", safeAmount);

            return `${currencySymbol}${safeAmount.toFixed(2)}`;
        },
        [currency]
    );

    const addExpense = (amount: number, category: string) => {
        const normalizedAmount =
            Number.isFinite(amount) && amount > 0 ? Number(amount) : 0;

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

    const setBudget = (amount: number) => {
        const normalizedAmount =
            Number.isFinite(amount) && amount > 0 ? Number(amount) : 0;
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
                formatAmount,
            }}
        >
            {children}
        </ExpenseContext.Provider>
    );
};
