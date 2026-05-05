// Override @opentui/solid JSX types to accept additional
// runtime props used throughout the TUI.
declare module "@opentui/solid/jsx-runtime" {
  namespace JSX {
    interface TextProps {
      fg?: unknown
      bg?: unknown
      backgroundColor?: unknown
      attributes?: unknown
      selectable?: boolean
      wrapMode?: "none" | "char" | "word" | "truncate-end" | "truncate-middle" | "truncate-start"
      width?: number
      paddingLeft?: number
      paddingRight?: number
      paddingTop?: number
      paddingBottom?: number
      onMouseUp?: (event: MouseEvent) => void | boolean
      flexShrink?: number
      flexGrow?: number
      flexBasis?: number | string
      alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "baseline" | "stretch"
      margin?: number
      marginLeft?: number
      marginRight?: number
      marginTop?: number
      marginBottom?: number
      style?: any
      children?: unknown
    }
    interface IntrinsicElements {
      text: TextProps
      [key: string]: any
    }
    type Element = any
    interface ElementChildrenAttribute {
      children: any
    }
  }
}
