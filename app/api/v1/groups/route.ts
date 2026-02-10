import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: Request) {
    try {
        const authError = verifyApiToken(req)
        if (authError) return authError

        const result = await query('SELECT * FROM groups ORDER BY created_at DESC')
        return NextResponse.json({ success: true, data: result.rows })
    } catch (error) {
        console.error('Get groups error:', error)
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const authError = verifyApiToken(req)
        if (authError) return authError

        const { id, name, admin_email, balance, alert_threshold } = await req.json()

        if (!id || !name) {
            return NextResponse.json(
                { success: false, error: 'ID and Name are required' },
                { status: 400 }
            )
        }

        await query(
            `INSERT INTO groups (id, name, admin_email, balance, alert_threshold)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = $2, admin_email = $3, balance = $4, alert_threshold = $5`,
            [id, name, admin_email, balance || 0, alert_threshold || 10.00]
        )

        return NextResponse.json({
            success: true,
            message: 'Group created/updated successfully',
        })
    } catch (error) {
        console.error('Create group error:', error)
        return NextResponse.json(
            { success: false, error: 'Internal Server Error' },
            { status: 500 }
        )
    }
}

export async function DELETE(req: Request) {
    try {
        const authError = verifyApiToken(req)
        if (authError) return authError

        const { searchParams } = new URL(req.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json(
                { success: false, error: 'ID is required' },
                { status: 400 }
            )
        }

        await query('DELETE FROM groups WHERE id = $1', [id])

        return NextResponse.json({
            success: true,
            message: 'Group deleted successfully',
        })
    } catch (error) {
        console.error('Delete group error:', error)
        return NextResponse.json(
            { success: false, error: 'Internal Server Error' },
            { status: 500 }
        )
    }
}
