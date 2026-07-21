'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────

type TableShape = 'round' | 'square' | 'rectangle';

export interface FloorTable {
  id?: number;
  merchantId?: number;
  label: string;
  shape: TableShape;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  isActive: boolean;
  sortOrder: number;
}

interface FloorPlanEditorProps {
  merchantId: number;
  editable: boolean;
  onTableClick?: (tableLabel: string) => void;
  tableStatuses?: Record<string, { status: string; customerName?: string; orderCode?: string; totalAmount?: number }>;
}

// ─── Constants ────────────────────────────────────────

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const GRID_SIZE = 20;
const MIN_TABLE_SIZE = 40;

const STATUS_COLORS: Record<string, string> = {
  served: '#22c55e',
  pending: '#22d3ee',
  request: '#facc15',
  bill_out: '#d946ef',
  reserved: '#ef4444',
  open: '#e5e7eb',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  open: '#6b7280',
  served: '#ffffff',
  pending: '#ffffff',
  request: '#1f2937',
  bill_out: '#ffffff',
  reserved: '#ffffff',
};

// ─── Component ────────────────────────────────────────

export default function FloorPlanEditor({
  merchantId,
  editable,
  onTableClick,
  tableStatuses = {},
}: FloorPlanEditorProps) {
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ idx: number; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ idx: number; corner: string; startX: number; startY: number; startW: number; startH: number; startPX: number; startPY: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const snap = useCallback((v: number) => (snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : v), [snapToGrid]);

  // ─── Data fetching ──────────────────────────────

  const fetchTables = useCallback(async () => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/merchants/${merchantId}/floor-tables`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch floor tables');
      const data = await res.json();
      setTables(data);
    } catch (err) {
      console.error('Error fetching floor tables:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  // ─── CRUD helpers ───────────────────────────────

  const addTable = () => {
    const count = tables.length;
    const newTable: FloorTable = {
      label: `Table ${count + 1}`,
      shape: 'square',
      capacity: 4,
      posX: snap(CANVAS_WIDTH / 2 - 50),
      posY: snap(CANVAS_HEIGHT / 2 - 50),
      width: 100,
      height: 100,
      rotation: 0,
      isActive: true,
      sortOrder: count,
    };
    setTables((prev) => [...prev, newTable]);
    setSelectedId(count);
    setHasChanges(true);
  };

  const deleteTable = (idx: number) => {
    setTables((prev) => prev.filter((_, i) => i !== idx));
    setSelectedId(null);
    setHasChanges(true);
  };

  const updateTable = (idx: number, patch: Partial<FloorTable>) => {
    setTables((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setHasChanges(true);
  };

  const saveLayout = async () => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/merchants/${merchantId}/floor-tables/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tables }),
      });
      if (!res.ok) throw new Error('Failed to save layout');
      const saved = await res.json();
      setTables(saved);
      setHasChanges(false);
      toast.success('Layout saved');
    } catch (err) {
      console.error('Error saving layout:', err);
      toast.error('Failed to save layout');
    }
  };

  const resetLayout = () => {
    setHasChanges(false);
    setSelectedId(null);
    fetchTables();
  };

  // ─── Drag handling ──────────────────────────────

  const handleMouseDown = (e: React.MouseEvent, idx: number) => {
    if (!editable) {
      const table = tables[idx];
      onTableClick?.(table.label);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(idx);

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setDragging({ idx, offsetX: mouseX - tables[idx].posX, offsetY: mouseY - tables[idx].posY });
  };

  const handleResizeStart = (e: React.MouseEvent, idx: number, corner: string) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const t = tables[idx];
    setResizing({
      idx,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      startW: t.width,
      startH: t.height,
      startPX: t.posX,
      startPY: t.posY,
    });
  };

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMove = (e: MouseEvent) => {
      if (dragging) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = snap(e.clientX - rect.left - dragging.offsetX);
        const y = snap(e.clientY - rect.top - dragging.offsetY);
        const t = tables[dragging.idx];
        const clampedX = Math.max(0, Math.min(CANVAS_WIDTH - t.width, x));
        const clampedY = Math.max(0, Math.min(CANVAS_HEIGHT - t.height, y));
        updateTable(dragging.idx, { posX: clampedX, posY: clampedY });
      }
      if (resizing) {
        const dx = e.clientX - resizing.startX;
        const dy = e.clientY - resizing.startY;
        const { corner, startW, startH, startPX, startPY } = resizing;

        let newW = startW;
        let newH = startH;
        let newPX = startPX;
        let newPY = startPY;

        if (corner.includes('r')) newW = Math.max(MIN_TABLE_SIZE, snap(startW + dx));
        if (corner.includes('l')) {
          newW = Math.max(MIN_TABLE_SIZE, snap(startW - dx));
          newPX = snap(startPX + (startW - newW));
        }
        if (corner.includes('b')) newH = Math.max(MIN_TABLE_SIZE, snap(startH + dy));
        if (corner.includes('t')) {
          newH = Math.max(MIN_TABLE_SIZE, snap(startH - dy));
          newPY = snap(startPY + (startH - newH));
        }

        updateTable(resizing.idx, { width: newW, height: newH, posX: newPX, posY: newPY });
      }
    };

    const handleUp = () => {
      setDragging(null);
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, resizing, snapToGrid]);

  // ─── Touch handling for mobile ──────────────────

  const handleTouchStart = (e: React.TouchEvent, idx: number) => {
    if (!editable) {
      const table = tables[idx];
      onTableClick?.(table.label);
      return;
    }
    e.stopPropagation();
    setSelectedId(idx);
    const touch = e.touches[0];
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = touch.clientX - rect.left;
    const mouseY = touch.clientY - rect.top;
    setDragging({ idx, offsetX: mouseX - tables[idx].posX, offsetY: mouseY - tables[idx].posY });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragging) return;
      const touch = e.touches[0];
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = snap(touch.clientX - rect.left - dragging.offsetX);
      const y = snap(touch.clientY - rect.top - dragging.offsetY);
      const t = tables[dragging.idx];
      const clampedX = Math.max(0, Math.min(CANVAS_WIDTH - t.width, x));
      const clampedY = Math.max(0, Math.min(CANVAS_HEIGHT - t.height, y));
      updateTable(dragging.idx, { posX: clampedX, posY: clampedY });
    };

    const handleTouchEnd = () => setDragging(null);

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, snapToGrid]);

  // ─── Canvas click to deselect ───────────────────

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) setSelectedId(null);
  };

  // ─── Shape rendering helpers ────────────────────

  const getShapeClasses = (shape: TableShape) => {
    switch (shape) {
      case 'round': return 'rounded-full';
      case 'square': return 'rounded-lg';
      case 'rectangle': return 'rounded-lg';
    }
  };

  const selectedTable = selectedId !== null ? tables[selectedId] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Main Canvas Area */}
      <div className="flex-1 min-w-0">
        {/* Toolbar */}
        {editable && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={addTable}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Table
            </button>
            <button
              onClick={saveLayout}
              disabled={!hasChanges}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                hasChanges ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Layout
            </button>
            <button
              onClick={resetLayout}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </button>
            <label className="flex items-center gap-1.5 ml-auto text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              Snap to grid
            </label>
          </div>
        )}

        {/* Canvas */}
        <div
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="relative border-2 border-gray-300 rounded-xl bg-white overflow-hidden select-none"
          style={{
            width: '100%',
            maxWidth: CANVAS_WIDTH,
            aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
            backgroundImage: editable
              ? `radial-gradient(circle, #d1d5db 1px, transparent 1px)`
              : 'none',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        >
          {/* Scale wrapper for responsive canvas */}
          <div
            className="absolute inset-0"
            style={{ transformOrigin: 'top left' }}
          >
            {tables.map((table, idx) => {
              const status = tableStatuses[table.label]?.status || 'open';
              const bgColor = editable ? (selectedId === idx ? '#dbeafe' : '#f3f4f6') : (STATUS_COLORS[status] || STATUS_COLORS.open);
              const textColor = editable ? '#374151' : (STATUS_TEXT_COLORS[status] || STATUS_TEXT_COLORS.open);
              const customerName = tableStatuses[table.label]?.customerName;
              const totalAmount = tableStatuses[table.label]?.totalAmount;

              return (
                <div
                  key={idx}
                  onMouseDown={(e) => handleMouseDown(e, idx)}
                  onTouchStart={(e) => handleTouchStart(e, idx)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!editable) onTableClick?.(table.label);
                    else setSelectedId(idx);
                  }}
                  className={`absolute flex flex-col items-center justify-center border-2 transition-shadow ${
                    getShapeClasses(table.shape)
                  } ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:shadow-lg'} ${
                    selectedId === idx && editable ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-gray-300'
                  }`}
                  style={{
                    left: `${(table.posX / CANVAS_WIDTH) * 100}%`,
                    top: `${(table.posY / CANVAS_HEIGHT) * 100}%`,
                    width: `${(table.width / CANVAS_WIDTH) * 100}%`,
                    height: `${(table.height / CANVAS_HEIGHT) * 100}%`,
                    backgroundColor: bgColor,
                    color: textColor,
                    transform: `rotate(${table.rotation}deg)`,
                    zIndex: selectedId === idx ? 20 : 10,
                  }}
                  title={`${table.label} – ${table.capacity} seats`}
                >
                  <span className="text-[10px] lg:text-xs font-bold leading-tight truncate max-w-full px-1">
                    {table.label}
                  </span>
                  {!editable && customerName && (
                    <span className="text-[8px] lg:text-[10px] opacity-80 truncate max-w-full px-1">{customerName}</span>
                  )}
                  {!editable && totalAmount !== undefined && totalAmount > 0 && (
                    <span className="text-[8px] lg:text-[10px] font-semibold">₱{totalAmount.toFixed(0)}</span>
                  )}
                  <span className="text-[7px] lg:text-[9px] opacity-60">{table.capacity} seats</span>

                  {/* Resize handles (edit mode only) */}
                  {editable && selectedId === idx && (
                    <>
                      {['tl', 'tr', 'bl', 'br'].map((corner) => (
                        <div
                          key={corner}
                          onMouseDown={(e) => handleResizeStart(e, idx, corner)}
                          className="absolute w-3 h-3 bg-blue-500 border border-white rounded-sm z-30"
                          style={{
                            cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                            top: corner.includes('t') ? -5 : undefined,
                            bottom: corner.includes('b') ? -5 : undefined,
                            left: corner.includes('l') ? -5 : undefined,
                            right: corner.includes('r') ? -5 : undefined,
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {tables.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
              <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <p className="text-sm font-medium">No tables configured</p>
              {editable && <p className="text-xs mt-1">Click &quot;Add Table&quot; to get started</p>}
            </div>
          )}
        </div>
      </div>

      {/* Properties Panel (edit mode only) */}
      {editable && selectedTable && selectedId !== null && (
        <div className="w-full lg:w-64 bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Table Properties</h3>
            <button
              onClick={() => setSelectedId(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Label */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Label</label>
            <input
              type="text"
              value={selectedTable.label}
              onChange={(e) => updateTable(selectedId, { label: e.target.value })}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          {/* Shape Selector */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Shape</label>
            <div className="grid grid-cols-3 gap-1">
              {(['round', 'square', 'rectangle'] as TableShape[]).map((shape) => (
                <button
                  key={shape}
                  onClick={() => {
                    const patch: Partial<FloorTable> = { shape };
                    if (shape === 'rectangle') patch.width = Math.max(selectedTable.width, 140);
                    else if (shape === 'round' || shape === 'square') {
                      const size = Math.min(selectedTable.width, selectedTable.height);
                      patch.width = size;
                      patch.height = size;
                    }
                    updateTable(selectedId, patch);
                  }}
                  className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                    selectedTable.shape === shape
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {shape === 'round' ? '⬤' : shape === 'square' ? '◼' : '▬'} {shape.charAt(0).toUpperCase() + shape.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Capacity */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Capacity</label>
            <input
              type="number"
              min={1}
              max={20}
              value={selectedTable.capacity}
              onChange={(e) => updateTable(selectedId, { capacity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Width</label>
              <input
                type="number"
                min={MIN_TABLE_SIZE}
                max={CANVAS_WIDTH}
                value={Math.round(selectedTable.width)}
                onChange={(e) => updateTable(selectedId, { width: Math.max(MIN_TABLE_SIZE, parseInt(e.target.value) || MIN_TABLE_SIZE) })}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Height</label>
              <input
                type="number"
                min={MIN_TABLE_SIZE}
                max={CANVAS_HEIGHT}
                value={Math.round(selectedTable.height)}
                onChange={(e) => updateTable(selectedId, { height: Math.max(MIN_TABLE_SIZE, parseInt(e.target.value) || MIN_TABLE_SIZE) })}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Rotation */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Rotation ({selectedTable.rotation}°)</label>
            <input
              type="range"
              min={0}
              max={360}
              value={selectedTable.rotation}
              onChange={(e) => updateTable(selectedId, { rotation: parseInt(e.target.value) })}
              className="w-full accent-red-600"
            />
          </div>

          {/* Active Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedTable.isActive}
              onChange={(e) => updateTable(selectedId, { isActive: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <span className="text-xs text-gray-700 font-medium">Active</span>
          </label>

          {/* Delete Button */}
          <button
            onClick={() => deleteTable(selectedId)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Table
          </button>
        </div>
      )}
    </div>
  );
}
