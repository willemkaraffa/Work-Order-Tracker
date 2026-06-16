// React contexts + their hooks, carved out of app.jsx. Extracted before
// primitives so shared atoms (PMChip, StatusPill) can read context without an
// app.jsx <-> primitives import cycle. Dep direction: constants <- contexts.
import React from 'react';
import { DEFAULT_PHASES, DEFAULT_STATUS_COLORS, DEFAULT_PMS } from './constants.js';

export const PhasesContext = React.createContext(DEFAULT_PHASES);
export function usePhases() { return React.useContext(PhasesContext); }

export const StatusColorsContext = React.createContext(DEFAULT_STATUS_COLORS);
export function useStatusColors() { return React.useContext(StatusColorsContext); }

export const ToastContext = React.createContext(() => {});
export function useToast() { return React.useContext(ToastContext); }

export const PMsContext = React.createContext(DEFAULT_PMS);
export function usePMs() { return React.useContext(PMsContext); }
