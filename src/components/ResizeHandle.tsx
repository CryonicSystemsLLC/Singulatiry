import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({ direction, onResize, onResizeEnd }) => {
  const startPos = useRef(0);
  const isResizing = useRef(false);
  // Use refs so mousemove always calls the latest callback
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos.current;
      startPos.current = currentPos;
      onResizeRef.current(delta);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEndRef.current?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative shrink-0 z-10 ${
        isHorizontal
          ? 'cursor-col-resize'
          : 'cursor-row-resize'
      }`}
      style={{
        [isHorizontal ? 'width' : 'height']: '6px',
      }}
    >
      {/* Visible center line on hover / active */}
      <div className={`absolute bg-transparent group-hover:bg-[var(--accent-primary)] transition-colors ${
        isHorizontal
          ? 'top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px]'
          : 'left-0 right-0 top-1/2 -translate-y-1/2 h-[2px]'
      }`} />
    </div>
  );
};

export default React.memo(ResizeHandle);
