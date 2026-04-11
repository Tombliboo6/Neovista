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
      {/* 手机端降级提示 */}
      <div className="md:hidden h-screen flex items-center justify-center px-8 text-center" style={{ background: 'var(--surface-0)' }}>
        <div>
          <div className="text-4xl mb-4">🖥️</div>
          <p className="font-display font-bold text-white text-xl mb-2">请在桌面端使用</p>
          <p className="text-white/40 text-sm">NeoVista 工作区需要较大屏幕以获得完整体验</p>
        </div>
      </div>

      {/* 桌面/Pad 布局 */}
      <div className="hidden md:flex h-screen overflow-hidden" style={{ background: 'var(--surface-0)' }}>
        <LeftNav />
        <div className="flex-1 relative overflow-hidden h-full">
          <CenterCanvas />
          {/* Pad 端折叠按钮 */}
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="lg:hidden absolute top-3 right-3 z-10 p-2 rounded-lg transition hover:bg-white/10"
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
