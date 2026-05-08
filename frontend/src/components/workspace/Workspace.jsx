import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import LeftNav from './LeftNav';
import CenterCanvas from './CenterCanvas';
import RightPanel from './RightPanel';
import AuthModal from '../auth/AuthModal';
import { Maximize2, Minimize2, PanelRight } from 'lucide-react';

const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'neovista.workspace.rightPanelWidth';
const RIGHT_PANEL_DEFAULT_WIDTH = 384;
const RIGHT_PANEL_WIDE_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 360;
const RIGHT_PANEL_MAX_WIDTH = 560;
const CENTER_CANVAS_MIN_WIDTH = 760;
const LEFT_NAV_WIDTH = 68;

function getMaxRightPanelWidth() {
  if (typeof window === 'undefined') return RIGHT_PANEL_MAX_WIDTH;
  const canvasProtectedWidth = window.innerWidth - LEFT_NAV_WIDTH - CENTER_CANVAS_MIN_WIDTH;
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(RIGHT_PANEL_MAX_WIDTH, canvasProtectedWidth),
  );
}

function clampRightPanelWidth(width) {
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(getMaxRightPanelWidth(), width),
  );
}

function getInitialRightPanelWidth() {
  if (typeof window === 'undefined') return RIGHT_PANEL_DEFAULT_WIDTH;
  const storedWidth = Number(localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
  return clampRightPanelWidth(Number.isFinite(storedWidth) && storedWidth > 0
    ? storedWidth
    : RIGHT_PANEL_DEFAULT_WIDTH);
}

export default function Workspace() {
  const location = useLocation();
  const setActiveSkill = useAppStore((state) => state.setActiveSkill);
  const setActiveTemplateName = useAppStore((state) => state.setActiveTemplateName);
  const initWorkspaceFromHome = useAppStore((state) => state.initWorkspaceFromHome);
  const initWorkspaceWithMessage = useAppStore((state) => state.initWorkspaceWithMessage);
  const showAuthModal = useAppStore((state) => state.showAuthModal);
  const setShowAuthModal = useAppStore((state) => state.setShowAuthModal);
  const lastTemplateId = useRef(null);
  const resizeStateRef = useRef(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(getInitialRightPanelWidth);
  const isWidePanel = rightPanelWidth >= RIGHT_PANEL_WIDE_WIDTH - 8;

  useEffect(() => {
    const templateId = location.state?.templateId;
    if (templateId && templateId !== lastTemplateId.current) {
      setActiveSkill(templateId);
      if (location.state?.templateName) setActiveTemplateName(location.state.templateName);
      lastTemplateId.current = templateId;
    }
    if (location.state?.messages) initWorkspaceFromHome(location.state.messages, location.state?.sessionId);
    if (location.state?.initMessage && location.state?.sessionId) initWorkspaceWithMessage(location.state.initMessage, location.state.sessionId);
  }, [location.state, setActiveSkill, setActiveTemplateName, initWorkspaceFromHome, initWorkspaceWithMessage]);

  useEffect(() => {
    localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    const handleWindowResize = () => {
      setRightPanelWidth((width) => clampRightPanelWidth(width));
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const setStoredRightPanelWidth = (width) => {
    const nextWidth = clampRightPanelWidth(width);
    setRightPanelWidth(nextWidth);
  };

  const handlePanelResizePointerDown = (event) => {
    if (!rightPanelOpen) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: rightPanelWidth,
    };

    const handlePointerMove = (moveEvent) => {
      if (!resizeStateRef.current) return;
      const nextWidth = resizeStateRef.current.startWidth + (resizeStateRef.current.startX - moveEvent.clientX);
      setRightPanelWidth(clampRightPanelWidth(nextWidth));
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleWidePanelToggle = () => {
    const nextWidth = isWidePanel ? RIGHT_PANEL_DEFAULT_WIDTH : RIGHT_PANEL_WIDE_WIDTH;
    setStoredRightPanelWidth(nextWidth);
    setRightPanelOpen(true);
  };

  return (
    <>
      <div className="flex min-h-[100dvh] items-center justify-center px-8 text-center md:hidden" style={{ background: 'var(--surface-0)' }}>
        <div className="max-w-sm rounded-2xl border px-6 py-7" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-panel)' }}>
          <p className="mb-2 font-display text-xl font-semibold text-white/90">请在桌面端打开工作区</p>
          <p className="text-sm leading-6 text-white/45">NeoVista 画布、技能面板和图层工具需要更宽的操作空间。</p>
        </div>
      </div>

      <div className="hidden h-[100dvh] overflow-hidden md:flex" style={{ background: 'var(--surface-0)' }}>
        <LeftNav />
        <div className="flex-1 relative overflow-hidden h-full">
          <CenterCanvas />
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="absolute right-3 top-3 z-10 rounded-lg p-2 transition hover:bg-white/10 lg:hidden"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            title={rightPanelOpen ? '收起面板' : '展开面板'}
          >
            <PanelRight size={16} className="text-white/50" />
          </button>
        </div>
        <div
          className="relative h-full overflow-hidden transition-all duration-300"
          style={{ width: rightPanelOpen ? `${rightPanelWidth}px` : '0px' }}
        >
          {rightPanelOpen && (
            <>
              <div
                role="separator"
                aria-label="拖拽调整右侧面板宽度"
                aria-orientation="vertical"
                onPointerDown={handlePanelResizePointerDown}
                className="absolute left-0 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none transition hover:bg-brand-gold/20 lg:block"
                title="拖拽调整右侧面板宽度"
              />
              <button
                type="button"
                aria-label="切换宽面板模式"
                onClick={handleWidePanelToggle}
                className="absolute right-3 top-3 z-30 hidden rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white/75 lg:block"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                title={isWidePanel ? '恢复默认面板宽度' : '切换宽面板模式'}
              >
                {isWidePanel ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </>
          )}
          <div style={{ width: `${rightPanelWidth}px` }} className="h-full">
            <RightPanel />
          </div>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    </>
  );
}
