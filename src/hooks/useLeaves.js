// src/hooks/useLeaves.js
import { useEffect, useState } from "react";
import {
  getLeaves,
  setLeaves,
  addLeave,
  removeLeave,
  replaceLeaves,
  onLeavesChange,
} from "../store/leavesStore.js";

export default function useLeaves() {
  const [leaves, setState] = useState(() => getLeaves());

  useEffect(() => {
    const off = onLeavesChange((next) => setState(next));
    return off;
  }, []);

  return {
    leaves,
    setLeaves: (updater) => {
      const next = setLeaves(updater);
      setState(next);
    },
    addLeave: (leave) => {
      const next = addLeave(leave);
      setState(next);
    },
    removeLeave: (predOrId) => {
      const next = removeLeave(predOrId);
      setState(next);
    },
    replaceLeaves: (arr) => {
      const next = replaceLeaves(arr);
      setState(next);
    },
  };
}
