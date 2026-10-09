import { NextResponse } from 'next/server'
import { scheduledSqlTasksService } from '@/lib/services/scheduledSqlTasks.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    scheduledSqlTasksService.startScheduler()
    const tasks = await scheduledSqlTasksService.getAll()
    return NextResponse.json({ success: true, data: tasks })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const task = await scheduledSqlTasksService.create(body)
    return NextResponse.json({ success: true, data: task })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const task = await scheduledSqlTasksService.update(Number(body.id), body)
    return NextResponse.json({ success: true, data: task })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (id) {
      await scheduledSqlTasksService.delete(Number(id))
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')
    if (runId) {
      await scheduledSqlTasksService.runTask(Number(runId))
      return NextResponse.json({ success: true, message: 'Görev çalıştırıldı' })
    }
    return NextResponse.json({ success: false, error: 'Id gerekli' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}