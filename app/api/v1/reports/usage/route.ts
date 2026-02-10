import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: Request) {
    try {
        const authError = verifyApiToken(req)
        if (authError) return authError

        const { searchParams } = new URL(req.url)
        const startDate = searchParams.get('start_date')
        const endDate = searchParams.get('end_date')
        const type = searchParams.get('type') || 'user'
        const sortField = searchParams.get('sortField')
        const sortOrder = searchParams.get('sortOrder') || 'descend'
        const names = searchParams.get('names')

        // Adjust dates to include full day only if they are simple YYYY-MM-DD strings
        const isSimpleDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
        const start = startDate && isSimpleDate(startDate) ? `${startDate} 00:00:00` : (startDate || '1970-01-01 00:00:00')
        const end = endDate && isSimpleDate(endDate) ? `${endDate} 23:59:59` : (endDate || '2100-01-01 23:59:59')

        let sql = ''
        let params: any[] = []
        const baseParams = [start, end]

        // Map frontend field names to SQL column names
        const sortMap: Record<string, string> = {
            name: 'name',
            tokens: '(total_input_tokens + total_output_tokens)',
            usage: 'total_usage',
            topup: 'total_topup',
            net: '(total_topup - total_usage)',
        }

        const orderBy = sortField && sortMap[sortField] 
            ? `ORDER BY ${sortMap[sortField]} ${sortOrder === 'ascend' ? 'ASC' : 'DESC'}`
            : 'ORDER BY total_usage DESC'

        const nameFilter = names 
            ? `AND name = ANY($3::text[])` 
            : ''

        if (type === 'group') {
            sql = `
                WITH usage_agg AS (
                    SELECT 
                        ugm.group_id,
                        SUM(COALESCE(ur.input_tokens, 0)) as total_input_tokens,
                        SUM(COALESCE(ur.output_tokens, 0)) as total_output_tokens,
                        SUM(ur.cost) as total_usage
                    FROM user_usage_records ur
                    JOIN user_group_mapping ugm ON ur.user_id = ugm.user_id
                    WHERE ur.use_time BETWEEN $1 AND $2
                    GROUP BY ugm.group_id
                ),
                topup_agg AS (
                    SELECT 
                        group_id,
                        SUM(amount) as total_topup
                    FROM transactions
                    WHERE type = 'TOPUP' AND created_at BETWEEN $1 AND $2
                    GROUP BY group_id
                ),
                final_report AS (
                    SELECT 
                        g.id,
                        g.name,
                        COALESCE(u.total_usage, 0) as total_usage,
                        COALESCE(t.total_topup, 0) as total_topup,
                        COALESCE(u.total_input_tokens, 0) as total_input_tokens,
                        COALESCE(u.total_output_tokens, 0) as total_output_tokens
                    FROM groups g
                    LEFT JOIN usage_agg u ON g.id = u.group_id
                    LEFT JOIN topup_agg t ON g.id = t.group_id
                    WHERE u.group_id IS NOT NULL OR t.group_id IS NOT NULL
                )
                SELECT * FROM final_report
                WHERE 1=1 ${nameFilter}
                ${orderBy}
            `
        } else {
            sql = `
                WITH usage_agg AS (
                    SELECT 
                        user_id,
                        SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
                        SUM(COALESCE(output_tokens, 0)) as total_output_tokens,
                        SUM(cost) as total_usage
                    FROM user_usage_records
                    WHERE use_time BETWEEN $1 AND $2
                    GROUP BY user_id
                ),
                topup_agg AS (
                    SELECT 
                        user_id,
                        SUM(amount) as total_topup
                    FROM transactions
                    WHERE type = 'TOPUP' AND created_at BETWEEN $1 AND $2
                    GROUP BY user_id
                ),
                final_report AS (
                    SELECT 
                        u.id,
                        u.name,
                        u.email,
                        COALESCE(ua.total_usage, 0) as total_usage,
                        COALESCE(ta.total_topup, 0) as total_topup,
                        COALESCE(ua.total_input_tokens, 0) as total_input_tokens,
                        COALESCE(ua.total_output_tokens, 0) as total_output_tokens
                    FROM users u
                    LEFT JOIN usage_agg ua ON u.id = ua.user_id
                    LEFT JOIN topup_agg ta ON u.id = ta.user_id
                    WHERE ua.user_id IS NOT NULL OR ta.user_id IS NOT NULL
                )
                SELECT * FROM final_report
                WHERE 1=1 ${nameFilter}
                ${orderBy}
            `
        }

        params = names ? [...baseParams, names.split(',')] : baseParams

        const result = await query(sql, params)
        return NextResponse.json({ success: true, data: result.rows })
    } catch (error) {
        console.error('Report error:', error)
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
    }
}
