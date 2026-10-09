'use client'

import React from 'react'

export interface DesignBlock {
  id: string;
  bandId?: string;
  type: 'text' | 'variable' | 'barcode' | 'qrcode' | 'line' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  value: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textDirection?: 'horizontal' | 'vertical';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  autoFitText?: boolean;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface ReportBand {
  id: string;
  type: 'ReportTitle' | 'PageHeader' | 'MasterData' | 'PageFooter';
  name: string;
  height: number;
}

export interface FormDesign {
  id: string;
  name: string;
  type: 'barcode' | 'a4' | 'label';
  linkedAssistance: string;
  width?: string;
  height?: string;
  printOffsetX?: string;
  printOffsetY?: string;
  printOffsetRight?: string;
  printOffsetBottom?: string;
  content: string;
  bands?: ReportBand[];
  blocks?: DesignBlock[];
}

export interface FormDesignRendererProps {
  design: FormDesign;
  data: Record<string, any>;
  preview?: boolean;
}

const PX_PER_MM = 96 / 25.4;

export function FormDesignRenderer({ design, data, preview = false }: FormDesignRendererProps) {
  const formatPrintValue = (key: string, value: unknown) => {
    const text = String(value)
    const normalizedKey = key.toLocaleLowerCase('tr-TR')
    const isDateField =
      normalizedKey.includes('tarih') ||
      normalizedKey.includes('date') ||
      normalizedKey.endsWith('_at') ||
      normalizedKey.endsWith('.at')
    if (!isDateField) return text

    const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/)
    if (!isoDateMatch) return text
    return `${isoDateMatch[3]}.${isoDateMatch[2]}.${isoDateMatch[1]}`
  }

  const isSizedLabelDesign = () => {
    const width = parseInt(design.width || '', 10);
    const height = parseInt(design.height || '', 10);
    return (
      design.type === 'barcode' ||
      design.type === 'label' ||
      (Number.isFinite(width) && Number.isFinite(height) && (width !== 210 || height !== 297))
    );
  };

  const getCanvasStyle = (bandHeight?: number) => {
    if (isSizedLabelDesign()) {
      const w = parseFloat(design.width || '80') * PX_PER_MM;
      const h = parseFloat(design.height || '40') * PX_PER_MM;
      return { width: `${w}px`, height: `${h}px` };
    }
    const w = parseFloat(design.width || '210') * PX_PER_MM;
    const h = parseFloat(design.height || '297') * PX_PER_MM;
    return { width: `${w}px`, height: `${h}px` };
  };

  const getContentLayout = () => {
    const widthMm = parseFloat(design.width || (design.type === 'a4' ? '210' : '80'))
    const heightMm = parseFloat(design.height || (design.type === 'a4' ? '297' : '40'))
    const pageWidth = Math.max(1, widthMm * PX_PER_MM)
    const pageHeight = Math.max(1, heightMm * PX_PER_MM)
    const left = Math.max(0, parseFloat(design.printOffsetX || '0') * PX_PER_MM || 0)
    const top = Math.max(0, parseFloat(design.printOffsetY || '0') * PX_PER_MM || 0)
    const right = Math.max(0, parseFloat(design.printOffsetRight || '0') * PX_PER_MM || 0)
    const bottom = Math.max(0, parseFloat(design.printOffsetBottom || '0') * PX_PER_MM || 0)
    const scale = Math.max(
      0.05,
      Math.min(1, (pageWidth - left - right) / pageWidth, (pageHeight - top - bottom) / pageHeight),
    )
    return { left, top, scale }
  }

  const getPositionedBlockStyle = (block: DesignBlock, resolvedValue: string): React.CSSProperties => {
    const layout = getContentLayout()
    return {
      left: `${layout.left + block.x * layout.scale}px`,
      top: `${layout.top + block.y * layout.scale}px`,
      width: block.width ? `${block.width * layout.scale}px` : 'auto',
      height: block.height ? `${block.height * layout.scale}px` : 'auto',
      fontSize: `${getFittedFontSize(block, resolvedValue) * layout.scale}px`,
    }
  }

  const getNestedValue = (path: string) => {
    const directValue = data[path];
    if (directValue !== undefined && directValue !== null) return formatPrintValue(path, directValue);

    const nestedValue = path.split('.').reduce<unknown>((current, part) => {
      if (current && typeof current === 'object' && part in current) {
        return (current as Record<string, unknown>)[part];
      }
      return undefined;
    }, data);

    if (nestedValue !== undefined && nestedValue !== null) return formatPrintValue(path, nestedValue);

    const fallbackValue = data[path.split('.').at(-1) || ''];
    return fallbackValue !== undefined && fallbackValue !== null ? formatPrintValue(path, fallbackValue) : undefined;
  };

  const resolveValue = (value: string) => {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) => {
      return getNestedValue(key.trim()) ?? match;
    });
  };

  const getImageObjectFit = (block: DesignBlock): React.CSSProperties['objectFit'] =>
    /\{\{\s*kisi\.resim\s*\}\}/i.test(block.value) ? 'cover' : 'contain'

  const preserveLineIndentation = (value: string) =>
    value
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/ {2,}/g, (spaces) => '\u00a0'.repeat(spaces.length)))
      .join('\n');

  const renderTextWithFixedIndentation = (value: string) =>
    value.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
      const indentationLength = line.match(/^[ \u00a0]+/)?.[0].length || 0
      const content = line.slice(indentationLength)
      return (
        <span
          key={index}
          style={{
            display: 'block',
            textIndent: indentationLength ? `${indentationLength}ch` : undefined,
            whiteSpace: 'pre-wrap',
          }}
        >
          {content || '\u00a0'}
        </span>
      )
    });

  const isMultiPageA4 = design.type === 'a4' && (design.bands?.length || 0) > 1;

  const getBlockBoxStyle = (block: DesignBlock): React.CSSProperties => ({
    color: block.textColor || '#000000',
    backgroundColor: block.backgroundColor || 'transparent',
    borderColor: block.borderWidth ? (block.borderColor || '#000000') : 'transparent',
    borderWidth: `${block.borderWidth || 0}px`,
    borderStyle: block.borderWidth ? 'solid' : 'none',
    boxSizing: 'border-box',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
    writingMode: block.textDirection === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
    textOrientation: 'mixed',
    fontFamily: block.fontFamily || 'Arial, Helvetica, sans-serif',
  });

  const getFittedFontSize = (block: DesignBlock, value: string) => {
    const configuredSize = block.fontSize || 14
    if (!block.autoFitText || !block.width || !block.height) return configuredSize

    const textLength = Math.max(1, Array.from(value || ' ').length)
    const usableAlong = Math.max(4, (block.textDirection === 'vertical' ? block.height : block.width) - 4)
    const usableAcross = Math.max(4, (block.textDirection === 'vertical' ? block.width : block.height) - 4)
    return Math.max(5, Math.min(96, Math.floor(Math.min(usableAlong / (textLength * 0.62), usableAcross / 1.2) * 0.92)))
  }

  const renderPrintSafeBackground = (block: DesignBlock, value: string) => {
    const backgroundColor = block.backgroundColor
    const hasBackground = Boolean(backgroundColor && backgroundColor !== 'transparent')
    const isVerticalText = block.textDirection === 'vertical'
    if (!hasBackground && !isVerticalText) return null
    const textAlign = block.textAlign || 'left'
    const verticalAlign = block.verticalAlign || 'top'
    const textX = textAlign === 'center' ? '50%' : textAlign === 'right' ? '100%' : '0'
    const horizontalTextAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start'
    const verticalTextAnchor = verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'end' : 'start'
    const blockWidth = block.width || (block.fontSize || 14) * 2
    const blockHeight = block.height || block.fontSize || 14
    const fittedFontSize = getFittedFontSize(block, value)
    const textLines = value.replace(/\r\n?/g, '\n').split('\n')
    const lineHeight = fittedFontSize * 1.25
    const textGroupHeight = Math.max(0, textLines.length - 1) * lineHeight
    const horizontalTextY = verticalAlign === 'middle'
      ? blockHeight / 2 - textGroupHeight / 2 + fittedFontSize * 0.35
      : verticalAlign === 'bottom'
        ? blockHeight - textGroupHeight - fittedFontSize * 0.1
        : fittedFontSize * 1.05
    return (
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', writingMode: 'horizontal-tb' }}
      >
        {hasBackground && <rect width="100%" height="100%" fill={backgroundColor} />}
        <text
          x={isVerticalText ? (verticalAlign === 'middle' ? blockHeight / 2 : verticalAlign === 'bottom' ? blockHeight : 0) : textX}
          y={isVerticalText ? blockWidth / 2 + fittedFontSize * 0.35 : horizontalTextY}
          fill={block.textColor || '#000000'}
          fontFamily={block.fontFamily || 'Arial, Helvetica, sans-serif'}
          fontSize={fittedFontSize}
          fontWeight={block.fontWeight || 'normal'}
          textAnchor={isVerticalText ? verticalTextAnchor : horizontalTextAnchor}
          xmlSpace="preserve"
          transform={isVerticalText ? `matrix(0 1 -1 0 ${blockWidth} 0)` : undefined}
          style={{
            fill: block.textColor || '#000000',
            writingMode: 'horizontal-tb',
          }}
        >
          {isVerticalText
            ? value
            : textLines.map((line, index) => (
                <tspan key={index} x={textX} y={index === 0 ? horizontalTextY : undefined} dy={index === 0 ? undefined : lineHeight}>
                  {line || '\u00a0'}
                </tspan>
              ))}
        </text>
      </svg>
    )
  }

  const getTextVerticalPositionStyle = (block: DesignBlock): React.CSSProperties => {
    const verticalAlign = block.verticalAlign || 'top'
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      top: verticalAlign === 'top' ? 0 : verticalAlign === 'middle' ? '50%' : '100%',
      transform: verticalAlign === 'middle' ? 'translateY(-50%)' : verticalAlign === 'bottom' ? 'translateY(-100%)' : undefined,
      zIndex: 1,
      display: 'block',
      width: '100%',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    }
  }

  if (isMultiPageA4) {
    return (
      <div className="space-y-8 print:space-y-0">
        {design.bands?.map((band, idx) => (
          <div 
            key={band.id}
            className={`form-design-print-page relative bg-white border ${preview ? 'shadow-lg' : 'border-none'} overflow-hidden print:shadow-none print:break-after-page`}
            style={getCanvasStyle(band.height)}
          >
            {design.blocks?.filter(block => block.bandId === band.id).map(block => (
              <div
                key={block.id}
                className="absolute pointer-events-none"
                style={{
                  ...getPositionedBlockStyle(block, resolveValue(block.value)),
                  fontWeight: block.fontWeight || 'normal',
                  ...getBlockBoxStyle(block),
                }}
              >
                {block.type === 'line' ? (
                  <div 
                    className="bg-slate-950" 
                    style={{ width: block.width ? '100%' : `${parseInt(block.value || '100')}px`, height: block.height ? '100%' : '1px' }}
                  />
                ) : block.type === 'image' ? (
                  <img
                    src={resolveValue(block.value)}
                    alt=""
                    className="h-full w-full"
                    style={{ objectFit: getImageObjectFit(block) }}
                    draggable={false}
                  />
                ) : block.type === 'barcode' ? (
                  <div className="flex flex-col items-center gap-1 border border-slate-300 p-1" style={{ width: block.width ? '100%' : 'auto', height: block.height ? '100%' : 'auto', backgroundColor: 'transparent' }}>
                    <div className="flex-1 w-full bg-[repeating-linear-gradient(90deg,black,black_2px,transparent_2px,transparent_4px)] min-h-[2rem]" />
                    <span className="text-[10px] whitespace-nowrap">{resolveValue(block.value)}</span>
                  </div>
                ) : block.type === 'qrcode' ? (
                  <div className="flex flex-col items-center gap-1 overflow-hidden border border-slate-300 p-1" style={{ width: block.width ? '100%' : 'auto', height: block.height ? '100%' : 'auto', backgroundColor: 'transparent' }}>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(resolveValue(block.value))}`} alt="QR" className="flex-1 w-full object-contain" style={{ minWidth: 0, minHeight: 0, height: 'calc(100% - 16px)' }} />
                    <span className="truncate max-w-full text-center" style={{ flex: '0 0 12px', width: '100%', fontSize: '11px', fontWeight: 700, lineHeight: '12px' }}>{resolveValue(block.value)}</span>
                  </div>
                ) : (
                  <div 
                    className="leading-tight break-words overflow-hidden"
                    style={{ 
                      position: 'relative',
                      width: block.width ? '100%' : 'auto',
                      height: block.height ? '100%' : 'auto',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      textAlign: block.textAlign || 'left',
                      color: 'inherit',
                      backgroundColor: 'transparent',
                    }}
                  >
                    {renderPrintSafeBackground(block, preserveLineIndentation(resolveValue(block.value)))}
                    {(!block.backgroundColor || block.backgroundColor === 'transparent') && block.textDirection !== 'vertical' && (
                      <span style={getTextVerticalPositionStyle(block)}>{renderTextWithFixedIndentation(resolveValue(block.value))}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div 
      className={`relative bg-white border ${preview ? 'shadow-lg' : 'border-none'} overflow-hidden`} 
      style={getCanvasStyle()}
    >
      {design.bands?.map((band, bandIndex) => (
        <div 
          key={band.id} 
          className={preview ? 'relative border-b border-dashed border-slate-200 last:border-b-0' : 'relative'}
          style={{
            height: isSizedLabelDesign() && bandIndex === 0
              ? `${parseFloat(design.height || '40') * PX_PER_MM}px`
              : `${band.height}px`
          }}
        >
          {preview && (
            <div className="absolute top-0 right-0 bg-slate-100 px-1 text-[9px] text-slate-800 font-bold select-none">
              {band.name}
            </div>
          )}
          {design.blocks?.filter(block => block.bandId === band.id).map(block => (
            <div
              key={block.id}
              className="absolute pointer-events-none"
              style={{
                ...getPositionedBlockStyle(block, resolveValue(block.value)),
                fontWeight: block.fontWeight || 'normal',
                ...getBlockBoxStyle(block),
              }}
            >
              {block.type === 'line' ? (
                <div 
                  className="bg-slate-950" 
                  style={{ width: block.width ? '100%' : `${parseInt(block.value || '100')}px`, height: block.height ? '100%' : '1px' }}
                />
              ) : block.type === 'image' ? (
                <img
                  src={resolveValue(block.value)}
                  alt=""
                  className="h-full w-full"
                  style={{ objectFit: getImageObjectFit(block) }}
                  draggable={false}
                />
              ) : block.type === 'barcode' ? (
                <div className="flex flex-col items-center gap-1 border border-slate-300 p-1" style={{ width: block.width ? '100%' : 'auto', height: block.height ? '100%' : 'auto', backgroundColor: 'transparent' }}>
                  <div className="flex-1 w-full bg-[repeating-linear-gradient(90deg,black,black_2px,transparent_2px,transparent_4px)] min-h-[2rem]" />
                  <span className="text-[10px] whitespace-nowrap">{resolveValue(block.value)}</span>
                </div>
              ) : block.type === 'qrcode' ? (
                <div className="flex flex-col items-center gap-1 overflow-hidden border border-slate-300 p-1" style={{ width: block.width ? '100%' : 'auto', height: block.height ? '100%' : 'auto', backgroundColor: 'transparent' }}>
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(resolveValue(block.value))}`} alt="QR" className="flex-1 w-full object-contain" style={{ minWidth: 0, minHeight: 0, height: 'calc(100% - 16px)' }} />
                  <span className="truncate max-w-full text-center" style={{ flex: '0 0 12px', width: '100%', fontSize: '11px', fontWeight: 700, lineHeight: '12px' }}>{resolveValue(block.value)}</span>
                </div>
              ) : (
                <div 
                  className="leading-tight break-words overflow-hidden"
                  style={{ 
                    position: 'relative',
                    width: block.width ? '100%' : 'auto',
                    height: block.height ? '100%' : 'auto',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    textAlign: block.textAlign || 'left',
                    color: 'inherit',
                  }}
                >
                  {renderPrintSafeBackground(block, preserveLineIndentation(resolveValue(block.value)))}
                  {(!block.backgroundColor || block.backgroundColor === 'transparent') && block.textDirection !== 'vertical' && (
                    <span style={getTextVerticalPositionStyle(block)}>{renderTextWithFixedIndentation(resolveValue(block.value))}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {!design.bands?.length && design.blocks?.map(block => (
        <div
          key={block.id}
          className="absolute pointer-events-none"
          style={{
            ...getPositionedBlockStyle(block, resolveValue(block.value)),
            fontWeight: block.fontWeight || 'normal',
            ...getBlockBoxStyle(block),
          }}
        >
          {block.type === 'line' ? (
            <div 
              className="bg-slate-950" 
              style={{ width: block.width ? '100%' : `${parseInt(block.value || '100')}px`, height: block.height ? '100%' : '1px' }}
            />
          ) : block.type === 'image' ? (
            <img
              src={resolveValue(block.value)}
              alt=""
              className="h-full w-full"
              style={{ objectFit: getImageObjectFit(block) }}
              draggable={false}
            />
          ) : block.type === 'barcode' ? (
            <div className="flex flex-col items-center gap-1 border border-slate-300 p-1" style={{ backgroundColor: 'transparent' }}>
              <div className="h-8 w-24 bg-[repeating-linear-gradient(90deg,black,black_2px,transparent_2px,transparent_4px)]" />
              <span className="text-[10px]">{resolveValue(block.value)}</span>
            </div>
          ) : block.type === 'qrcode' ? (
            <div className="flex flex-col items-center gap-1 overflow-hidden border border-slate-300 p-1" style={{ backgroundColor: 'transparent' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(resolveValue(block.value))}`} alt="QR" className="w-16 h-16 object-contain" style={{ minWidth: 0, minHeight: 0 }} />
              <span className="truncate max-w-[4rem] text-center" style={{ flex: '0 0 12px', width: '100%', fontSize: '11px', fontWeight: 700, lineHeight: '12px' }}>{resolveValue(block.value)}</span>
            </div>
          ) : (
            <div 
              className="leading-tight break-words overflow-hidden"
              style={{ 
                position: 'relative',
                width: block.width ? '100%' : 'auto',
                height: block.height ? '100%' : 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                textAlign: block.textAlign || 'left',
                color: 'inherit',
              }}
            >
              {renderPrintSafeBackground(block, preserveLineIndentation(resolveValue(block.value)))}
              {(!block.backgroundColor || block.backgroundColor === 'transparent') && block.textDirection !== 'vertical' && (
                <span style={getTextVerticalPositionStyle(block)}>{renderTextWithFixedIndentation(resolveValue(block.value))}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
