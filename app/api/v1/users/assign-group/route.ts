import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { verifyApiToken } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const authError = verifyApiToken(req)
        if (authError) return authError

        const { user_id, group_id } = await req.json()
        
        if (!user_id) {
            return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 })
        }

        if (!group_id || group_id === 'none') {
            await query('DELETE FROM user_group_mapping WHERE user_id = $1', [user_id])
            return NextResponse.json({ success: true, message: 'User removed from group' })
        }

        await query(
            `INSERT INTO user_group_mapping (user_id, group_id) 
             VALUES ($1, $2) 
             ON CONFLICT (user_id) DO UPDATE SET group_id = $2`,
            [user_id, group_id]
        )

        return NextResponse.json({ success: true, message: 'User assigned to group successfully' })
    } catch (error) {
        console.error('Assign group error:', error)
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
    }
}
