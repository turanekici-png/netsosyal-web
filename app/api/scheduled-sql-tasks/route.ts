import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import {
  scheduledSqlTasksService,
  type ScheduledSqlTaskInput,
} from '@/lib/services/scheduledSqlTasks.service'

export const dynamic = "force-dynamic"
export const runtime = 'nodejs'

scheduledSqlTasksService.startScheduler()

export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/scheduled-tasks' })
    if (accessDenied) return accessDenied

    scheduledSqlTasksService.startScheduler()
    const tasks = await scheduledSqlTasksService.getAll()

    return NextResponse.json({
      success: true,
      data: tasks,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/scheduled-tasks' })
    if (accessDenied) return accessDenied

    scheduledSqlTasksService.startScheduler()
    const body = await request.json()
    const task = await scheduledSqlTasksService.create(body as ScheduledSqlTaskInput)

    return NextResponse.json({
      success: true,
      data: task,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/scheduled-tasks' })
    if (accessDenied) return accessDenied

    scheduledSqlTasksService.startScheduler()
    const body = await request.json()
    const id = Number(body.id)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Görev numarası zorunludur.' },
        { status: 400 }
      )
    }

    const task = await scheduledSqlTasksService.update(id, body as ScheduledSqlTaskInput)

    return NextResponse.json({
      success: true,
      data: task,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/scheduled-tasks' })
    if (accessDenied) return accessDenied

    scheduledSqlTasksService.startScheduler()
    const body = await request.json()
    const id = Number(body.id)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Görev numarası zorunludur.' },
        { status: 400 }
      )
    }

    await scheduledSqlTasksService.runTask(id)

    return NextResponse.json({
      success: true,
      message: 'Görev başarıyla çalıştırıldı.'
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/scheduled-tasks' })
    if (accessDenied) return accessDenied

    scheduledSqlTasksService.startScheduler()
    const url = new URL(request.url)
    const id = Number(url.searchParams.get('id'))

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Görev numarası zorunludur.' },
        { status: 400 }
      )
    }

    await scheduledSqlTasksService.delete(id)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
