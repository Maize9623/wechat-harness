import type { SVGProps } from 'react'

type IconName =
  | 'search' | 'plus' | 'chat' | 'board' | 'folder-plus' | 'mode' | 'model'
  | 'plugin' | 'palette' | 'pet' | 'settings' | 'pin' | 'edit' | 'branch'
  | 'terminal' | 'shield' | 'send' | 'stop' | 'folder' | 'more' | 'spark'
  | 'code' | 'robot' | 'check' | 'chevron' | 'archive' | 'usage' | 'image' | 'list' | 'trash' | 'forward' | 'download'
  | 'people' | 'file' | 'server'

export function WhaleMark({ size = 28, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg {...props} viewBox="0 0 50 50" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M48.84 10.05c-.52-.26-.74.23-1.04.48-1.1 1.17-2.07 1.65-3.04 1.57-1.67-.1-3.1.44-4.35 1.74-.27-1.61-1.16-2.57-2.52-3.18-1.65-.74-2.02-1.55-2.54-2.93-.11-.33-.22-.66-.59-.72-.4-.07-.56.28-.71.57-1.86 3.47-.82 7.74 2.85 10.76.28.19.35.38.26.66l-.53 1.71c-.11.37-.28.45-.67.29-3.7-1.58-5.86-5.16-8.73-7.48-.45-.34-.91-.66-1.38-.97-1.99-1.97.26-3.58.78-3.78.54-.2.19-.89-1.57-.88-2.38.01-4.45 1.14-6.35 1.69-7.4-1.44-13.04.78-16.87 6.17C-.98 19.11-.32 28.73 8.07 38.88c6.3 5.32 15.26 6.32 23.03.58 2.9 1.47 7.75.78 7.02.55 1.48-.32 1.38-1.72.84-1.98-4.34-2.06-3.38-1.22-4.25-1.9 4.49-5.42 7.09-10.77 6.83-16.14-.01-.35.07-.49.46-.53 4.72-.55 7.81-3.1 8.17-8.21.04-.47-.01-.96-.5-1.2ZM24.33 37.84c-4.21-3.38-6.25-4.49-7.09-4.44-.79.05-.65.97-.48 1.57.18.59.42 1 .75 1.52.23.34.39.86-.23 1.24-1.35.86-3.71-.29-3.82-.35C7.93 34.06 4.5 28.15 4.2 21.37c-.04-.79.19-1.07.96-1.22 6.27-1.18 11.2 1.1 14.1 5.63 4.36 4.4 5.87 9.3 11.22 13.33-1.61.18-4.31.22-6.15-1.27Zm2.02-13.24a.63.63 0 1 1 1.23 0 .63.63 0 0 1-1.23 0Zm6.26 3.28c-2.14.9-3.5-.24-3.91-1.75-.31-1.56.65-1.8-.45-2.71-.61-.52-1.35-.36-1.9-.57-.22-.11-.4-.39-.23-.73.66-1.3 2.54-.59 3.93 1.21 1.24 1.47 2.36 3.75 2.56 4.55Z" />
    </svg>
  )
}

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const common = {
    ...props,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
    case 'plus': return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
    case 'chat': return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6a3.5 3.5 0 0 1-3.5 3.5H10l-4.8 4v-4.5A3.5 3.5 0 0 1 4 11.8Z"/></svg>
    case 'board': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M8 10h13"/></svg>
    case 'folder-plus': return <svg {...common}><path d="M3 7.5h6l2-2h3l2 2h5v11H3Z"/><path d="M12 10v5M9.5 12.5h5"/></svg>
    case 'mode': return <svg {...common}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/></svg>
    case 'model': return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/></svg>
    case 'plugin': return <svg {...common}><path d="M8.5 3v4.5H4v4h4.5V16h4v-4.5H17V8h-4.5V3Z"/><path d="M6 18h12v3H6z"/></svg>
    case 'palette': return <svg {...common}><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-12Z"/><circle cx="7" cy="10" r=".8" fill="currentColor"/><circle cx="9" cy="6.5" r=".8" fill="currentColor"/><circle cx="14" cy="6" r=".8" fill="currentColor"/></svg>
    case 'pet': return <svg {...common}><circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="5" cy="13" r="2"/><circle cx="19" cy="13" r="2"/><path d="M8 17.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5c0 1.7-1.2 2.5-4 2.5s-4-.8-4-2.5Z"/></svg>
    case 'settings': return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z"/></svg>
    case 'pin': return <svg {...common}><path d="m9 3 6 6M8 8l8-4-4 8 5 5-5 1-5 5-1-1 5-5 1-5Z"/></svg>
    case 'edit': return <svg {...common}><path d="M4 20h4l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg>
    case 'branch': return <svg {...common}><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 10c5 0 5-3 8-3"/></svg>
    case 'terminal': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/></svg>
    case 'shield': return <svg {...common}><path d="M12 3 4.5 6v5c0 4.6 3 8 7.5 10 4.5-2 7.5-5.4 7.5-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>
    case 'send': return <svg {...common}><path d="m4 12 15-8-4 16-3.5-6.5Z"/><path d="m11.5 13.5 3.5-4"/></svg>
    case 'stop': return <svg {...common}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>
    case 'folder': return <svg {...common}><path d="M3 6h7l2 2h9v11H3Z"/></svg>
    case 'more': return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>
    case 'spark': return <svg {...common}><path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6ZM18.5 15l.8 2.7L22 18.5l-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z"/></svg>
    case 'code': return <svg {...common}><path d="m9 6-6 6 6 6M15 6l6 6-6 6"/></svg>
    case 'robot': return <svg {...common}><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></svg>
    case 'check': return <svg {...common}><path d="m5 12 4 4 10-10"/></svg>
    case 'chevron': return <svg {...common}><path d="m8 10 4 4 4-4"/></svg>
    case 'archive': return <svg {...common}><path d="M4 7h16v13H4Z"/><path d="M3 3h18v4H3ZM9 11h6"/></svg>
    case 'usage': return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m4 7 6-4 6 6 5-5"/></svg>
    case 'image': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 5"/></svg>
    case 'list': return <svg {...common}><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>
    case 'trash': return <svg {...common}><path d="M4 7h16M9 3h6l1 4H8Z"/><path d="m6 7 1 14h10l1-14M10 11v6M14 11v6"/></svg>
    case 'forward': return <svg {...common}><path d="m14 5 6 6-6 6v-4C8 13 5 15 3 19c.5-7 4-11 11-11Z"/></svg>
    case 'download': return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>
    case 'people': return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2h1.8a3.7 3.7 0 0 1 3.7 3.7V19"/></svg>
    case 'file': return <svg {...common}><path d="M6 2.5h8l4 4V21H6Z"/><path d="M14 2.5V7h4M9 12h6M9 16h6"/></svg>
    case 'server': return <svg {...common}><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h7M11 17.5h7"/></svg>
  }
}
