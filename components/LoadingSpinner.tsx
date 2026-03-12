
import React from 'react';

interface LoadingSpinnerProps {
  small?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ small }) => {
  if (small) {
    return (
      <div className="flex justify-center items-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-600 dark:border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center p-8">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600"></div>
    </div>
  );
};

export default LoadingSpinner;
