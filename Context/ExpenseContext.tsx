import React, { createContext, useCallback, useEffect, useState } from "react";
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

type ExchangeRatesResponse = {
    rates?: Record<string, number>;
    result?: string;
};

const CURRENCY_SYMBOL_FALLBACKS: Record<string, string> = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CNY: "¥",
    AUD: "$",
    CAD: "$",
    CHF: "Fr.",
    SGD: "$",
    AED: "د.إ",
    SAR: "﷼",
};

interface ExpenseContextType {
    expenses: Expense[];
    budget: number;
    isDarkMode: boolean;
    currency: string;
    exchangeRates: Record<string, number>;
    isFetchingRates: boolean;
    addExpense: (amount: number, category: string) => void;
    setBudget: (value: number) => void;
    setCurrency: (value: string) => void;
    setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
    clearExpenses: () => void;
    fetchExchangeRates: (force?: boolean) => Promise<void>;
    convertFromUSD: (amount: number) => number;
    formatAmount: (amountInUSD: number) => string;
}

export const ExpenseContext = createContext<ExpenseContextType>(
    {} as ExpenseContextType
);

interface ExpenseProviderProps {
    children: React.ReactNode;
}

export const ExpenseProvider = ({ children }: ExpenseProviderProps) => {
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [budget, setBudgetInUSD] = useState<number>(0);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
    const [currency, setCurrencyState] = useState<string>("INR");
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({
        USD: 1,
    });
    const [isFetchingRates, setIsFetchingRates] = useState<boolean>(false);
    const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

    const cacheDurationMs = 60 * 60 * 1000;

    const setCurrency = useCallback((value: string) => {
        const normalized = value.toUpperCase();
        if (SUPPORTED_CURRENCIES.includes(normalized as (typeof SUPPORTED_CURRENCIES)[number])) {
            setCurrencyState(normalized);
            return;
        }
        setCurrencyState("INR");
    }, []);

    const convertFromUSD = useCallback(
        (amountInUSD: number) => {
            const rate = exchangeRates[currency] ?? 1;
            if (!Number.isFinite(rate) || rate <= 0) {
                return amountInUSD;
            }
            return amountInUSD * rate;
        },
        [currency, exchangeRates]
    );

    const convertToUSD = useCallback(
        (amountInSelectedCurrency: number) => {
            const rate = exchangeRates[currency] ?? 1;
            if (!Number.isFinite(rate) || rate <= 0) {
                return amountInSelectedCurrency;
            }
            return amountInSelectedCurrency / rate;
        },
        [currency, exchangeRates]
    );

    const formatAmount = useCallback(
        (amountInUSD: number) => {
            const convertedAmount = convertFromUSD(amountInUSD);
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

                const resolvedSymbol =
                    symbolWithoutCountryPrefix.trim() ||
                    CURRENCY_SYMBOL_FALLBACKS[currency] ||
                    "$";

                const numericPart = new Intl.NumberFormat(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }).format(convertedAmount);

                return `${resolvedSymbol}${numericPart}`;
            } catch {
                const fallbackSymbol = CURRENCY_SYMBOL_FALLBACKS[currency] ?? "$";
                return `${fallbackSymbol}${convertedAmount.toFixed(2)}`;
            }
        },
        [convertFromUSD, currency]
    );

    const fetchExchangeRates = useCallback(
        async (force = false) => {
            if (isFetchingRates && !force) {
                return;
            }

            const now = Date.now();
            const hasSupportedRates = SUPPORTED_CURRENCIES.every((code) => {
                const rate = exchangeRates[code];
                return Number.isFinite(rate) && rate > 0;
            });

            if (
                !force &&
                hasSupportedRates &&
                lastFetchedAt !== null &&
                now - lastFetchedAt < cacheDurationMs
            ) {
                return;
            }

            setIsFetchingRates(true);

            try {
                const response = await fetch("https://open.er-api.com/v6/latest/USD");
                if (!response.ok) {
                    throw new Error("Failed to fetch exchange rates.");
                }

                const data = (await response.json()) as ExchangeRatesResponse;
                if (!data.rates || data.result === "error") {
                    throw new Error("Invalid exchange rate response.");
                }

                const nextRates: Record<string, number> = { USD: 1 };
                SUPPORTED_CURRENCIES.forEach((code) => {
                    const rate = data.rates?.[code];
                    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
                        nextRates[code] = rate;
                    }
                });

                setExchangeRates((currentRates) => ({
                    ...currentRates,
                    ...nextRates,
                    USD: 1,
                }));
                setLastFetchedAt(now);
            } catch {
                setExchangeRates({ USD: 1 });
                setCurrencyState("INR");
            } finally {
                setIsFetchingRates(false);
            }
        },
        [cacheDurationMs, exchangeRates, isFetchingRates, lastFetchedAt]
    );

    useEffect(() => {
        if (currency !== "USD") {
            void fetchExchangeRates();
        }
    }, [currency, fetchExchangeRates]);

    const addExpense = (amount: number, category: string) => {
        const amountInUSD = convertToUSD(amount);
        const normalizedAmount =
            Number.isFinite(amountInUSD) && amountInUSD > 0 ? amountInUSD : 0;

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

    const setBudget = (value: number) => {
        const amountInUSD = convertToUSD(value);
        const normalizedAmount =
            Number.isFinite(amountInUSD) && amountInUSD > 0 ? amountInUSD : 0;
        setBudgetInUSD(normalizedAmount);
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
                exchangeRates,
                isFetchingRates,
                fetchExchangeRates,
                convertFromUSD,
                formatAmount,
            }}
        >
            {children}
        </ExpenseContext.Provider>
    );
};
