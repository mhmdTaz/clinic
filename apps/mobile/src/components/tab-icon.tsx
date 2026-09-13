import Ionicons from '@expo/vector-icons/Ionicons'
import type { ComponentProps } from 'react'
import type { ColorValue } from 'react-native'

type IconName = ComponentProps<typeof Ionicons>['name']

/**
 * A tab's icon: filled when it is the current tab, outlined when it is not.
 *
 * The shape changes as well as the colour, so the current tab is clear to somebody who cannot tell
 * the tint from the grey (§14.5: never colour alone). Without an icon at all, the tab bar showed
 * React Navigation's placeholder triangle on every tab — found by running the app, not by reading it.
 */
export function tabIcon(filled: IconName, outline: IconName) {
  return function TabIcon({
    focused,
    color,
    size,
  }: {
    focused: boolean
    color: ColorValue
    size: number
  }) {
    return <Ionicons name={focused ? filled : outline} color={color as string} size={size} />
  }
}
