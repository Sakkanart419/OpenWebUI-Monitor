'use client'

import { useState, useEffect, useMemo } from 'react'
import { Table, Select, Button, Card, Statistic, Row, Col, Space } from 'antd'
import type { TablePaginationConfig } from 'antd/es/table'
import type { SorterResult, FilterValue } from 'antd/es/table/interface'
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import dayjs from '@/lib/dayjs'
import TimeRangeSelector, {
    TimeRangeType,
} from '@/components/panel/TimeRangeSelector'
import UsageRecordsTable from '@/components/panel/UsageRecordsTable'
import { useCurrency } from '@/hooks/use-currency'

interface TableParams {
    pagination: TablePaginationConfig
    sortField?: string
    sortOrder?: string
    filters?: Record<string, FilterValue | null>
}

export default function ReportsPage() {
    const { t } = useTranslation('common')
    const { formatCurrency } = useCurrency()
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<any[]>([])
    const [type, setType] = useState('user')
    const [namesList, setNamesList] = useState<string[]>([])

    const [dateRange, setDateRange] = useState<[Date, Date]>([
        dayjs().startOf('month').toDate(),
        dayjs().endOf('month').toDate(),
    ])

    const [selectedDetailName, setSelectedDetailName] = useState<string | null>(null)
    const [usageRecords, setUsageRecords] = useState<any[]>([])
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageTotal, setUsageTotal] = useState(0)
    const [usageTableParams, setUsageTableParams] = useState<TableParams>({
        pagination: {
            current: 1,
            pageSize: 10,
        },
    })

    const fetchUsageRecords = async (
        name: string,
        range: [Date, Date],
        params: TableParams
    ) => {
        setUsageLoading(true)
        try {
            const token = localStorage.getItem('access_token')
            const start = dayjs(range[0]).format('YYYY-MM-DD')
            const end = dayjs(range[1]).format('YYYY-MM-DD')

            const searchParams = new URLSearchParams()
            searchParams.append('startDate', start)
            searchParams.append('endDate', end)
            searchParams.append('page', params.pagination.current?.toString() || '1')
            searchParams.append('pageSize', params.pagination.pageSize?.toString() || '10')
            searchParams.append('users', name)

            if (params.sortField) {
                searchParams.append('sortField', params.sortField)
                searchParams.append('sortOrder', params.sortOrder || 'descend')
            }

            const res = await fetch(`/api/v1/panel/records?${searchParams.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            const result = await res.json()
            setUsageRecords(result.records)
            setUsageTotal(result.total)
        } catch (err) {
            console.error('Fetch usage records error:', err)
        } finally {
            setUsageLoading(false)
        }
    }

    const handleViewDetails = (name: string) => {
        setSelectedDetailName(name)
        fetchUsageRecords(name, dateRange, usageTableParams)
    }

    const handleUsageTableChange = (
        pagination: TablePaginationConfig,
        filters: Record<string, FilterValue | null>,
        sorter: SorterResult<any> | SorterResult<any>[]
    ) => {
        const newParams: TableParams = {
            pagination,
            filters,
            sortField: Array.isArray(sorter) ? undefined : (sorter.field as string),
            sortOrder: Array.isArray(sorter) ? undefined : (sorter.order as string | undefined),
        }
        setUsageTableParams(newParams)
        if (selectedDetailName) {
            fetchUsageRecords(selectedDetailName, dateRange, newParams)
        }
    }

    const [timeRangeType, setTimeRangeType] = useState<TimeRangeType>('month')
    const [availableTimeRange, setAvailableTimeRange] = useState<{
        minTime: Date
        maxTime: Date
    }>({
        minTime: dayjs().startOf('month').toDate(),
        maxTime: dayjs().endOf('month').toDate(),
    })

    const [tableParams, setTableParams] = useState<TableParams>({
        pagination: {
            current: 1,
            pageSize: 20,
        },
        filters: {
            name: null,
        },
    })

    const [globalQuota, setGlobalQuota] = useState<any>(null)

    const fetchGlobalQuota = async () => {
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/panel/global-quota', {
                headers: { Authorization: `Bearer ${token}` },
            })
            const result = await res.json()
            if (result.success) {
                setGlobalQuota(result.data)
            }
        } catch (err) {
            console.error('Fetch global quota error:', err)
        }
    }

    const fetchReport = async (range: [Date, Date], params: TableParams) => {
        setLoading(true)
        try {
            const token = localStorage.getItem('access_token')
            const start = dayjs(range[0]).format('YYYY-MM-DD')
            const end = dayjs(range[1]).format('YYYY-MM-DD')
            
            const searchParams = new URLSearchParams()
            searchParams.append('start_date', start)
            searchParams.append('end_date', end)
            searchParams.append('type', type)
            
            if (params.sortField) {
                searchParams.append('sortField', params.sortField)
                searchParams.append('sortOrder', params.sortOrder || 'descend')
            }
            
            if (params.filters?.name?.length) {
                searchParams.append('names', params.filters.name.join(','))
            }

            const res = await fetch(
                `/api/v1/reports/usage?${searchParams.toString()}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            )
            const result = await res.json()
            if (result.success) {
                setData(result.data)
                // Update names list for filters if not already set or if type changed
                const uniqueNames = Array.from(new Set(result.data.map((r: any) => r.name))) as string[]
                setNamesList(uniqueNames)
            }
        } catch (err) {
            console.error('Fetch report error:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const token = localStorage.getItem('access_token')
                const response = await fetch('/api/v1/panel/usage', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                })
                const usageData = await response.json()

                const minTime = dayjs(usageData.timeRange.minTime)
                    .startOf('day')
                    .toDate()
                const maxTime = dayjs(usageData.timeRange.maxTime)
                    .endOf('day')
                    .toDate()
                setAvailableTimeRange({ minTime, maxTime })

                const initialRange: [Date, Date] = [
                    dayjs().startOf('month').toDate(),
                    dayjs().endOf('month').toDate(),
                ]
                setDateRange(initialRange)
                setTimeRangeType('month')
                await fetchReport(initialRange, tableParams)
                await fetchGlobalQuota()
            } catch (error) {
                console.error('Failed to load initial data:', error)
                await fetchReport(dateRange, tableParams)
            }
        }

        loadInitialData()
    }, [])

    useEffect(() => {
        // Reset filters when type changes
        const newParams = {
            ...tableParams,
            filters: { name: null }
        }
        setTableParams(newParams)
        fetchReport(dateRange, newParams)
    }, [type])

    const handleTimeRangeChange = async (
        range: [Date, Date],
        type: TimeRangeType
    ) => {
        setTimeRangeType(type)
        setDateRange(range)
        await fetchReport(range, tableParams)
    }

    const handleTableChange = (
        pagination: TablePaginationConfig,
        filters: Record<string, FilterValue | null>,
        sorter: SorterResult<any> | SorterResult<any>[]
    ) => {
        const newParams: TableParams = {
            pagination,
            filters,
            sortField: Array.isArray(sorter)
                ? undefined
                : (sorter.field as string),
            sortOrder: Array.isArray(sorter)
                ? undefined
                : (sorter.order as string | undefined),
        }
        setTableParams(newParams)
        fetchReport(dateRange, newParams)
    }

    // Calculate totals using useMemo for better performance and reliability
    const totals = useMemo(() => {
        return data.reduce(
            (acc, curr) => {
                const input = parseInt(curr.total_input_tokens) || 0
                const output = parseInt(curr.total_output_tokens) || 0
                const usage = parseFloat(curr.total_usage) || 0
                const topup = parseFloat(curr.total_topup) || 0
                
                return {
                    tokens: acc.tokens + input + output,
                    usage: acc.usage + usage,
                    topup: acc.topup + topup,
                }
            },
            { tokens: 0, usage: 0, topup: 0 }
        )
    }, [data])

    const columns = [
        {
            title: type === 'user' ? t('records.columns.user') : t('groups.name'),
            dataIndex: 'name',
            key: 'name',
            sorter: true,
            filters: namesList.map((name: string) => ({ text: name, value: name })),
            filterSearch: true,
            filteredValue: tableParams.filters?.name || null,
            render: (name: string) => (
                <Button type="link" onClick={() => handleViewDetails(name)} style={{ padding: 0 }}>
                    {name}
                </Button>
            ),
        },
        {
            title: t('reports.totalTokensPeriod'),
            key: 'tokens',
            dataIndex: 'tokens', // Virtual field for sorting
            sorter: true,
            render: (_: any, record: any) => {
                const total =
                    Number(record.total_input_tokens || 0) +
                    Number(record.total_output_tokens || 0)
                return <span>{total.toLocaleString()}</span>
            },
        },
        {
            title: t('reports.totalUsagePeriod'),
            dataIndex: 'total_usage',
            key: 'usage',
            sorter: true,
            render: (val: number) => formatCurrency(Number(val)),
        },
        {
            title: t('reports.totalTopupPeriod'),
            dataIndex: 'total_topup',
            key: 'topup',
            sorter: true,
            render: (val: number) => formatCurrency(Number(val)),
        },
        {
            title: t('reports.netChange'),
            key: 'net',
            dataIndex: 'net', // Virtual field for sorting
            sorter: true,
            render: (_: any, record: any) => {
                const net =
                    Number(record.total_topup) - Number(record.total_usage)
                return (
                    <span style={{ color: net >= 0 ? 'green' : 'red' }}>
                        {net >= 0 ? '+' : ''}
                        {formatCurrency(net).replace(/[฿$]/g, '')}
                    </span>
                )
            },
        },
    ]

    const exportCSV = () => {
        const headers = [
            'Name',
            'Total Tokens',
            'Total Usage',
            'Total Top-up',
            'Net Change',
        ]
        const rows = data.map((r: any) => [
            r.name,
            Number(r.total_input_tokens || 0) +
                Number(r.total_output_tokens || 0),
            r.total_usage,
            r.total_topup,
            (Number(r.total_topup) - Number(r.total_usage)).toFixed(4),
        ])

        const csvContent = [headers, ...rows].map((e) => e.join(',')).join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
            'download',
            `report_${type}_${dayjs().format('YYYYMMDD')}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 pt-24 space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">{t('reports.title')}</h1>
                <Button
                    icon={<DownloadOutlined />}
                    onClick={exportCSV}
                    type="primary"
                >
                    {t('reports.exportCsv')}
                </Button>
            </div>

            {globalQuota?.enabled && (
                <Card title={t('panel.globalQuota.status')} className="shadow-sm border-blue-100 bg-blue-50/30">
                    <Row gutter={16}>
                        <Col span={6}>
                            <Statistic
                                title={t('panel.globalQuota.total')}
                                value={globalQuota.quota}
                                precision={2}
                                prefix={formatCurrency(0).startsWith('฿') ? '฿' : '$'}
                                formatter={(val) => formatCurrency(Number(val), 2).replace(/[฿$]/g, '')}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title={t('panel.globalQuota.used')}
                                value={globalQuota.usage}
                                precision={4}
                                prefix={formatCurrency(0).startsWith('฿') ? '฿' : '$'}
                                valueStyle={{ color: '#cf1322' }}
                                formatter={(val) => formatCurrency(Number(val), 4).replace(/[฿$]/g, '')}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title={t('panel.globalQuota.remaining')}
                                value={globalQuota.remaining}
                                precision={4}
                                prefix={formatCurrency(0).startsWith('฿') ? '฿' : '$'}
                                valueStyle={{ color: globalQuota.remaining > 0 ? '#3f8600' : '#cf1322' }}
                                formatter={(val) => formatCurrency(Number(val), 4).replace(/[฿$]/g, '')}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title={t('panel.globalQuota.expireDate')}
                                value={globalQuota.expireDate || t('panel.globalQuota.noLimit')}
                                formatter={(val) => {
                                    if (val === t('panel.globalQuota.noLimit')) return val
                                    return dayjs(val).format(t('common.dateFormat') || 'YYYY-MM-DD')
                                }}
                            />
                        </Col>
                    </Row>
                </Card>
            )}

            <Card className="shadow-sm">
                <div className="space-y-6">
                    <div className="flex items-center gap-4">
                        <span className="font-medium text-sm">{t('reports.type')}:</span>
                        <Select
                            value={type}
                            onChange={setType}
                            style={{ width: 200 }}
                            options={[
                                { value: 'user', label: t('reports.userReport') },
                                { value: 'group', label: t('reports.groupReport') },
                            ]}
                        />
                    </div>

                    <TimeRangeSelector
                        timeRange={dateRange}
                        timeRangeType={timeRangeType}
                        availableTimeRange={availableTimeRange}
                        onTimeRangeChange={handleTimeRangeChange}
                    />
                </div>
            </Card>

            <Row gutter={16}>
                <Col span={8}>
                    <Card>
                        <div translate="no" className="notranslate">
                            <Statistic
                                key={`tokens-${totals.tokens}`}
                                title={t('reports.totalTokensPeriod')}
                                value={totals.tokens}
                                precision={0}
                            />
                        </div>
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <div translate="no" className="notranslate">
                            <Statistic
                                key={`usage-${totals.usage}`}
                                title={t('reports.totalUsagePeriod')}
                                value={totals.usage}
                                precision={4}
                                prefix={formatCurrency(0).startsWith('฿') ? '฿' : '$'}
                                formatter={(val) => formatCurrency(Number(val), 4).replace(/[฿$]/g, '')}
                            />
                        </div>
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <div translate="no" className="notranslate">
                            <Statistic
                                key={`topup-${totals.topup}`}
                                title={t('reports.totalTopupPeriod')}
                                value={totals.topup}
                                precision={4}
                                prefix={formatCurrency(0).startsWith('฿') ? '฿' : '$'}
                                formatter={(val) => formatCurrency(Number(val), 4).replace(/[฿$]/g, '')}
                            />
                        </div>
                    </Card>
                </Col>
            </Row>

            <Table
                dataSource={data}
                columns={columns}
                loading={loading}
                rowKey="id"
                pagination={tableParams.pagination}
                onChange={handleTableChange}
            />

            {selectedDetailName && (
                <Card
                    title={`${t('reports.usageDetails')}: ${selectedDetailName}`}
                    className="shadow-sm"
                    extra={
                        <Button type="link" onClick={() => setSelectedDetailName(null)}>
                            {t('common.close')}
                        </Button>
                    }
                >
                    <UsageRecordsTable
                        loading={usageLoading}
                        records={usageRecords}
                        tableParams={{
                            ...usageTableParams,
                            pagination: {
                                ...usageTableParams.pagination,
                                total: usageTotal,
                            },
                        }}
                        models={[]} // These can be fetched if needed, but empty for now
                        users={[]} // These can be fetched if needed, but empty for now
                        onTableChange={handleUsageTableChange}
                    />
                </Card>
            )}
        </div>
    )
}
