'use client'

import { TabProvider } from '@/lib/context/TabContext'
import { DesignModeProvider } from '@/lib/context/DesignModeContext'
import { ShellZoomProvider } from '@/lib/context/ShellZoomContext'
import { UiScaleProvider } from '@/lib/context/UiScaleContext'
import { OpenFilesProvider } from '@/lib/context/OpenFilesContext'
import { DragScroll } from '@/components/shared/DragScroll'
import { SelectionCopyToolbar } from '@/components/shared/SelectionCopyToolbar'
import { GlobalAlertDialog } from '@/components/shared/GlobalAlertDialog'
import { GlobalConfirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { GlobalPromptDialog } from '@/components/shared/GlobalPromptDialog'
import { PwaProvider } from '@/components/pwa/PwaProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PwaProvider>
    <UiScaleProvider>
    <ShellZoomProvider>
    <TabProvider>
      <DesignModeProvider>
      <OpenFilesProvider>
        <DragScroll />
        <SelectionCopyToolbar />
        <GlobalAlertDialog />
        <GlobalConfirmDialog />
        <GlobalPromptDialog />
        {children}
      </OpenFilesProvider>
      </DesignModeProvider>
    </TabProvider>
    </ShellZoomProvider>
    </UiScaleProvider>
    </PwaProvider>
  )
}
