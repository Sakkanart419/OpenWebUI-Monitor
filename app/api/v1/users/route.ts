import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { ensureUserTableExists } from '@/lib/db/users'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
    const authError = verifyApiToken(req)
    if (authError) {
        return authError
    }

    try {
        await ensureUserTableExists()

        const { searchParams } = new URL(req.url)
        const page = parseInt(searchParams.get('page') || '1')
        const pageSize = parseInt(searchParams.get('pageSize') || '20')
        const sortField = searchParams.get('sortField')
        const sortOrder = searchParams.get('sortOrder')
        const search = searchParams.get('search')
        const deleted = searchParams.get('deleted') === 'true'
        const all = searchParams.get('all') === 'true'

        const conditions = [`deleted = ${deleted}`]
        const params = []
        let paramIndex = 1

        if (search) {
            conditions.push(
                `(LOWER(name) LIKE $${paramIndex} OR LOWER(email) LIKE $${paramIndex})`
            )
            params.push(`%${search.toLowerCase()}%`)
            paramIndex++
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`

        const countResult = await query(
            `SELECT COUNT(*) FROM users ${whereClause}`,
            params
        )
        const total = parseInt(countResult.rows[0].count)

        let queryStr = `SELECT u.id, u.email, u.name, u.role, u.balance, u.deleted, u.created_at, m.group_id
       FROM users u
       LEFT JOIN user_group_mapping m ON u.id = m.user_id
       ${whereClause.replace('WHERE ', 'WHERE u.')}
       ${
           sortField
               ? `ORDER BY u.${sortField} ${sortOrder === 'descend' ? 'DESC' : 'ASC'}`
               : 'ORDER BY u.created_at DESC'
       }`

        if (!all) {
            queryStr += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
            params.push(pageSize, (page - 1) * pageSize)
        }

        const result = await query(queryStr, params)

        return NextResponse.json({
            users: result.rows,
            total,
            page,
            pageSize,
        })
    } catch (error) {
        console.error('Failed to fetch users:', error)
        return NextResponse.json(
            { error: 'Failed to fetch users' },
            { status: 500 }
        )
    }
}
