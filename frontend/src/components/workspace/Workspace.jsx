import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import LeftNav from './LeftNav';
import CenterCanvas from './CenterCanvas';
import RightPanel from './RightPanel';
import AuthModal from '../auth/AuthModal';
import { PanelRight } from 'lucide-react';

export default function Workspace() {
  const location = useLocation();
  const setActiveSkill = useAppStore((state) => state.setActiveSkill);
  const setActiveTemplateName = useAppStore((state) => state.setActiveTemplateName);
  const initWorkspaceFromHome = useAppStore((state) => state.initWorkspaceFromHome);
  const initWorkspaceWithMessage = useAppStore((state) => state.initWorkspaceWithMessage);
  const showAuthModal = useAppStore((state) => state.showAuthModal);
  const setShowAuthModal = useAppStore((state) => state.setShowAuthModal);
  const lastTemplateId = useRef(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

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
          className="transition-all duration-300 overflow-hidden h-full"
          style={{ width: rightPanelOpen ? '384px' : '0px' }}
        >
          <div style={{ width: '384px' }} className="h-full">
            <RightPanel />
          </div>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    </>
  );
}
