import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

// Width from which the menu is a permanent rail instead of a slide-in panel (tablets, web).
export const DOCKED_MIN_WIDTH = 768;

interface SideMenuState {
  isOpen: boolean;
  docked: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const SideMenuContext = createContext<SideMenuState | null>(null);

export function SideMenuProvider({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const docked = width >= DOCKED_MIN_WIDTH;
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  // A docked rail has nothing to open or close, so it never reports itself as open.
  const value = useMemo(() => ({ isOpen: !docked && isOpen, docked, open, close, toggle }), [docked, isOpen, open, close, toggle]);
  return <SideMenuContext.Provider value={value}>{children}</SideMenuContext.Provider>;
}

export function useSideMenu(): SideMenuState {
  const ctx = useContext(SideMenuContext);
  // Outside the provider (roles that have not adopted the menu) it does nothing.
  return ctx ?? { isOpen: false, docked: false, open: () => {}, close: () => {}, toggle: () => {} };
}
