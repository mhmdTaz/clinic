'use client'

import Link from 'next/link'
import { LogOut, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@clinic/ui'
import { signOutAndLeave } from '@/components/auth/sign-out-button'

export function UserMenu({ name }: { name: string }) {
  const t = useTranslations()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('shell.userMenu')}
          className="hover:bg-muted flex min-h-11 items-center gap-2 rounded-full ps-1 pe-2"
        >
          <Avatar name={name} />
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound className="size-4" aria-hidden="true" />
            {t('shell.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOutAndLeave()}>
          <LogOut className="size-4" aria-hidden="true" />
          {t('common.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
