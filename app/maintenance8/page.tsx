'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast, Toaster } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
    Database, 
    Download, 
    Upload, 
    Wrench, 
    FileJson, 
    AlertTriangle,
    CheckCircle2,
    Loader2
} from 'lucide-react'
import AuthCheck from '@/components/AuthCheck'

export default function MaintenancePage() {
    const { t } = useTranslation('common')
    const [loading, setLoading] = useState<string | null>(null)

    const handleAction = async (action: string, data?: any) => {
        setLoading(action)
        try {
            const token = localStorage.getItem('access_token')
            const response = await fetch('/api/v1/panel/database/maintenance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action, data }),
            })

            const result = await response.json()

            if (!response.ok) throw new Error(result.error || 'Action failed')

            if (action === 'export_all' || action === 'export_models') {
                const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                    type: 'application/json',
                })
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `openwebui_monitor_${action}_${new Date().toISOString().split('T')[0]}.json`
                document.body.appendChild(a)
                a.click()
                window.URL.revokeObjectURL(url)
                toast.success('Export successful')
            } else {
                toast.success(result.message || 'Action completed successfully')
            }
        } catch (error) {
            console.error(error)
            toast.error(error instanceof Error ? error.message : 'Action failed')
        } finally {
            setLoading(null)
        }
    }

    const handleImportModels = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json'
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target?.result as string)
                    await handleAction('import_models', data)
                } catch (error) {
                    toast.error('Invalid JSON file')
                }
            }
            reader.readAsText(file)
        }
        input.click()
    }

    return (
        <AuthCheck>
            <Toaster richColors position="top-center" />
            <div className="max-w-4xl mx-auto px-4 py-24 space-y-8">
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Database className="w-8 h-8 text-primary" />
                        Database Maintenance
                    </h1>
                    <p className="text-muted-foreground">
                        Advanced database management and maintenance tools.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Schema Fix */}
                    <Card className="p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Wrench className="w-6 h-6 text-blue-600" />
                            </div>
                            <h2 className="text-xl font-semibold">Schema Maintenance</h2>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Check and fix database schema inconsistencies. This will ensure all required tables and columns exist.
                        </p>
                        <Button 
                            className="w-full" 
                            variant="outline"
                            onClick={() => handleAction('fix_schema')}
                            disabled={!!loading}
                        >
                            {loading === 'fix_schema' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                            Fix Database Schema
                        </Button>
                    </Card>

                    {/* Full Export */}
                    <Card className="p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <Download className="w-6 h-6 text-green-600" />
                            </div>
                            <h2 className="text-xl font-semibold">Full Data Export</h2>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Export all data including users, groups, transactions, and usage records to a JSON file.
                        </p>
                        <Button 
                            className="w-full" 
                            variant="outline"
                            onClick={() => handleAction('export_all')}
                            disabled={!!loading}
                        >
                            {loading === 'export_all' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileJson className="w-4 h-4 mr-2" />}
                            Export All Data
                        </Button>
                    </Card>

                    {/* Model Cost Management */}
                    <Card className="p-6 space-y-4 md:col-span-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-100 rounded-lg">
                                <AlertTriangle className="w-6 h-6 text-amber-600" />
                            </div>
                            <h2 className="text-xl font-semibold">Model Cost Management</h2>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Export or import model pricing configurations. Useful for migrating settings between environments.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Button 
                                variant="outline"
                                onClick={() => handleAction('export_models')}
                                disabled={!!loading}
                            >
                                {loading === 'export_models' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                                Export Model Costs
                            </Button>
                            <Button 
                                variant="outline"
                                onClick={handleImportModels}
                                disabled={!!loading}
                            >
                                {loading === 'import_models' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                                Import Model Costs
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </AuthCheck>
    )
}
