import { useEffect, useState } from 'react';

/**
 * Custom hook for managing dark mode globally across the app
 * Uses localStorage to persist the user's preference
 */
export const useDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Initialize from localStorage
    const savedMode = localStorage.getItem('darkMode');
    return savedMode === 'enabled';
  });

  useEffect(() => {
    // Apply dark mode class to body
    if (isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }

    // Save to localStorage
    localStorage.setItem('darkMode', isDarkMode ? 'enabled' : 'disabled');
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  const enableDarkMode = () => {
    setIsDarkMode(true);
  };

  const disableDarkMode = () => {
    setIsDarkMode(false);
  };

  return {
    isDarkMode,
    toggleDarkMode,
    enableDarkMode,
    disableDarkMode,
    setIsDarkMode
  };
};