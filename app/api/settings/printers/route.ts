import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

function normalizePrinterName(value: string) {
  return value.replace(/\r/g, '').trim()
}

async function discoverPrinters(): Promise<string[]> {
  const platform = process.platform

  if (platform !== 'win32') {
    return []
  }

  const commands = [
    { command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'] },
    { command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-WmiObject Win32_Printer | Select-Object -ExpandProperty Name'] },
  ]

  for (const commandSpec of commands) {
    try {
      const { stdout } = await execFileAsync(commandSpec.command, commandSpec.args, { windowsHide: true })
      const printerNames = stdout
        .split(/\n|\r\n/)
        .map(normalizePrinterName)
        .filter(Boolean)

      if (printerNames.length > 0) {
        return Array.from(new Set(printerNames)).sort((a, b) => a.localeCompare(b, 'tr'))
      }
    } catch {
      // Try the next fallback command.
    }
  }

  return []
}

export async function GET() {
  try {
    const printers = await discoverPrinters()

    return NextResponse.json({ success: true, data: { printers } })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Yazıcı listesi alınamadı.',
      },
      { status: 500 },
    )
  }
}
