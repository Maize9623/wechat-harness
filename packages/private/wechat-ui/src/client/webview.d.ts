import type { HTMLAttributes, DetailedHTMLProps } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        webpreferences?: string
        style?: import('react').CSSProperties
      }
    }
  }
}
