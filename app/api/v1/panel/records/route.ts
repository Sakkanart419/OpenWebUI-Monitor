import { query } from '@/lib/db/client'
import { NextResponse } from 'next/server'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: Request) {
    const authError = verifyApiToken(req)
    if (authError) {
        return authError
    }

    try {
        const { searchParams } = new URL(req.url)
        const page = parseInt(searchParams.get('page') || '1')
        const pageSize = parseInt(searchParams.get('pageSize') || '10')
        const sortField = searchParams.get('sortField')
        const sortOrder = searchParams.get('sortOrder')
        const users = searchParams.get('users')?.split(',') || []
        const models = searchParams.get('models')?.split(',') || []
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        const conditions = []
        const params = []
        let paramIndex = 1

        if (users.length > 0) {
            conditions.push(`nickname = ANY($${paramIndex})`)
            params.push(users)
            paramIndex++
        }

        if (models.length > 0) {
            conditions.push(`model_name = ANY($${paramIndex})`)
            params.push(models)
            paramIndex++
        }

        if (startDate && endDate) {
            // Adjust dates to include full day only if they are simple YYYY-MM-DD strings
            const isSimpleDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
            const start = isSimpleDate(startDate) ? `${startDate} 00:00:00` : startDate
            const end = isSimpleDate(endDate) ? `${endDate} 23:59:59` : endDate
            
            conditions.push(
                `use_time >= $${paramIndex} AND use_time <= $${paramIndex + 1}`
            )
            params.push(start)
            params.push(end)
            paramIndex += 2
        }

        const whereClause =
            conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const orderClause = sortField
            ? `ORDER BY ${sortField} ${sortOrder === 'descend' ? 'DESC' : 'ASC'}`
            : 'ORDER BY use_time DESC'

        const countQuery = `
      SELECT COUNT(*) 
      FROM user_usage_records uur
      ${whereClause.replace(/nickname/g, 'uur.nickname').replace(/model_name/g, 'uur.model_name').replace(/use_time/g, 'uur.use_time')}
    `
        const countResult = await query(countQuery, params)

        const offset = (page - 1) * pageSize
        const dataQuery = `
      SELECT 
        uur.user_id,
        uur.nickname,
        uur.use_time,
        uur.model_name,
        uur.input_tokens,
        uur.output_tokens,
        uur.cost,
        uur.balance_after,
        t.source as group_name
      FROM user_usage_records uur
      LEFT JOIN transactions t ON uur.id = t.record_id
      ${whereClause.replace(/nickname/g, 'uur.nickname').replace(/model_name/g, 'uur.model_name').replace(/use_time/g, 'uur.use_time')}
      ${orderClause.replace(/use_time/g, 'uur.use_time').replace(/nickname/g, 'uur.nickname').replace(/model_name/g, 'uur.model_name').replace(/cost/g, 'uur.cost').replace(/balance_after/g, 'uur.balance_after')}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

        const dataParams = [...params, pageSize, offset]
        const records = await query(dataQuery, dataParams)

        const total = parseInt(countResult.rows[0].count)

        return NextResponse.json({
            records: records.rows,
            total,
        })
    } catch (error) {
        console.error('Fail to fetch usage records:', error)
        return NextResponse.json(
            { error: 'Fail to fetch usage records' },
            { status: 500 }
        )
    }
}
