import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useAppStore } from '../../store/useAppStore';

export default function FabricCanvas() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const fabricInstanceRef = useRef(null);
  const drawingMode = useAppStore((state) => state.drawingMode);
  const setFabricInstance = useAppStore((state) => state.setFabricInstance);
  const saveCanvasState = useAppStore((state) => state.saveCanvasState);
  const deleteSelected = useAppStore((state) => state.deleteSelected);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#fbfaf6',
    });

    fabricInstanceRef.current = canvas;
    setFabricInstance(canvas);

    const handleCanvasChange = () => {
      saveCanvasState();
      const { isProgrammaticUpdate, markCanvasDirty } = useAppStore.getState();
      if (!isProgrammaticUpdate) {
        markCanvasDirty();
      }
    };

    canvas.on('object:added', handleCanvasChange);
    canvas.on('object:modified', handleCanvasChange);
    canvas.on('object:removed', handleCanvasChange);
    canvas.on('path:created', handleCanvasChange);

    const rect = new fabric.Rect({
      left: width / 2 - 100,
      top: height / 2 - 60,
      fill: '#5f837a',
      width: 200,
      height: 120,
      rx: 8,
      ry: 8,
      shadow: {
        color: 'rgba(30,27,20,0.16)',
        blur: 10,
        offsetX: 0,
        offsetY: 4,
      },
    });

    const text = new fabric.Text('NeoVista Canvas', {
      left: width / 2 - 70,
      top: height / 2 - 20,
      fill: '#ffffff',
      fontSize: 18,
      fontFamily: 'Avenir Next, PingFang SC, sans-serif',
    });

    canvas.add(rect, text);

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.setDimensions({ width: newWidth, height: newHeight });
    };

    const handleKeyDown = (e) => {
      // 第二道防线：检查焦点是否在输入框
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable;

      if (isInputFocused) {
        return; // 焦点在输入框，忽略删除操作
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      }
      // Ctrl+V 粘贴图片
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        navigator.clipboard.read().then(items => {
          for (const item of items) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                item.getType(type).then(blob => {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const { setProgrammaticUpdate } = useAppStore.getState();
                    setProgrammaticUpdate(true);
                    fabric.FabricImage.fromURL(event.target.result).then(img => {
                      img.set({ name: 'uploaded' });
                      img.scaleToWidth(canvas.width * 0.8);
                      canvas.centerObject(img);
                      canvas.add(img);
                      canvas.setActiveObject(img);
                      canvas.renderAll();
                      setProgrammaticUpdate(false);
                    });
                  };
                  reader.readAsDataURL(blob);
                });
              }
            }
          }
        }).catch(err => console.log('粘贴失败:', err));
      }
    };

    // 拖拽上传
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const { setProgrammaticUpdate } = useAppStore.getState();
          setProgrammaticUpdate(true);
          fabric.FabricImage.fromURL(event.target.result).then(img => {
            img.set({ name: 'uploaded' });
            img.scaleToWidth(canvas.width * 0.8);
            canvas.centerObject(img);
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
            setProgrammaticUpdate(false);
          });
        };
        reader.readAsDataURL(files[0]);
      }
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
  }, [deleteSelected, saveCanvasState, setFabricInstance]);

  useEffect(() => {
    const canvas = fabricInstanceRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = drawingMode;
    if (drawingMode) {
      const brush = new fabric.PencilBrush(canvas);
      brush.color = '#b84a3a';
      brush.width = 3;
      canvas.freeDrawingBrush = brush;
    }
  }, [drawingMode]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
