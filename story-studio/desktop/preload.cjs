const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismDesktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  chooseProjectLibrary: () => ipcRenderer.invoke('desktop:choose-project-library'),
  openProjectLibrary: () => ipcRenderer.invoke('desktop:open-project-library'),
  chooseH3Installation: () => ipcRenderer.invoke('desktop:choose-h3-installation'),
  chooseAceStepInstallation: () => ipcRenderer.invoke('desktop:choose-ace-step-installation'),
});
