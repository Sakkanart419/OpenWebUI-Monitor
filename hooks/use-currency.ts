'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function useCurrency() {
    const { i18n, t } = useTranslation('common')
    const [usdToThb, setUsdToThb] = useState<number | null>(null)

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const token = localStorage.getItem('access_token')
                const res = await fetch('/api/v1/config', {
                    headers: { Authorization: `Bearer ${token}` },
                })
                const data = await res.json()
                if (data.usdToThb) {
                    setUsdToThb(data.usdToThb)
                } else {
                    setUsdToThb(null)
                }
            } catch (err) {
                console.error('Failed to fetch currency config:', err)
            }
        }
        fetchConfig()
    }, [])

    const formatCurrency = (amount: number, precision: number = 4) => {
        const isThai = i18n.language === 'th'
        
        if (isThai && usdToThb !== null) {
            const symbol = t('common.currency')
            const convertedAmount = amount * usdToThb
            return `${symbol}${convertedAmount.toLocaleString(undefined, {
                minimumFractionDigits: precision,
                maximumFractionDigits: precision,
            })}`
        }

        // Default to USD if not Thai or if usdToThb is not set
        return `$${amount.toLocaleString(undefined, {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
        })}`
    }

    return {
        formatCurrency,
        usdToThb,
        isThai: i18n.language === 'th',
    }
}
