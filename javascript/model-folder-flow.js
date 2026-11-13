/* Model Folder Flow 0.2.6: preserves native Extra Networks search handlers. */
(() => {
  'use strict';
  if (window.__loraFolderRows) return;
  window.__loraFolderRows = true;
  const mounted = new Map();
  // Per mode/model-tab + full parent path; session-only, never localStorage.
  const scrollPositions = new Map();
  const storageKey = 'model-folder-flow.scope.v1';
  let scope = 'descendants';
  try { if (localStorage.getItem(storageKey) === 'direct') scope = 'direct'; } catch (_) {}
  function setScope(value) {
    scope = value === 'direct' ? 'direct' : 'descendants';
    try { localStorage.setItem(storageKey, scope); } catch (_) {}
    for (const state of mounted.values()) state.render();
  }
  window.addEventListener('storage', event => {
    if (event.key === storageKey) setScope(event.newValue);
  });
  // Only our class is changed. Native search visibility is never overridden.
  function filterCards(input, paths, active) {
    const container = app().querySelector('#' + CSS.escape(input.id.replace(/_extra_search$/, '_cards')));
    if (!container) return;
    const folders = [...paths.keys()].filter(Boolean).sort((a,b) => b.length-a.length);
    for (const card of container.querySelectorAll('.card')) {
      let excluded = false;
      if (active) {
        const raw = card.dataset.sortPath;
        if (raw) {
          const file = normalize(raw).toLowerCase();
          const directory = file.slice(0, file.lastIndexOf('/'));
          // Longest full directory suffix disambiguates same-named nested folders.
          const folder = folders.find(p => directory === p.toLowerCase() || directory.endsWith('/' + p.toLowerCase()));
          if (folder) excluded = scope === 'direct' ? folder !== active : !(folder === active || folder.startsWith(active + '/'));
          // Unknown path metadata is intentionally left to the native filter.
        }
      }
      card.classList.toggle('lfr-excluded', excluded);
    }
  }
  function clearCards(input) {
    const container = app().querySelector('#' + CSS.escape(input.id.replace(/_extra_search$/, '_cards')));
    container?.querySelectorAll('.lfr-excluded').forEach(card => card.classList.remove('lfr-excluded'));
  }
  const normalize = value => value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const app = () => typeof gradioApp === 'function' ? gradioApp() : document;
  let revealAvailable = false;
  const baseUrl = /^https?:$/.test(location.protocol) ? new URL('.', location.href) : null;
  // The backend additionally validates local Windows, Origin, and registered file.
  if (baseUrl && typeof fetch === 'function' && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)) {
    fetch(new URL('model-folder-flow/capabilities', baseUrl), {credentials:'same-origin'})
      .then(response=>response.ok?response.json():null)
      .then(value=>{revealAvailable=value?.reveal===true;schedule();}).catch(()=>{});
  }
  function installReveal(root) {
    if (!revealAvailable) return;
    for (const cards of root.querySelectorAll('[id$="_cards"]')) {
      const match = cards.id.match(/^(?:txt2img|img2img)_(lora|textual_inversion|checkpoints)_cards$/i);
      if (!match) continue;
      for (const card of cards.querySelectorAll('.card')) {
        if (!card.dataset.sortPath || card.querySelector('.lfr-reveal')) continue;
        const button = document.createElement('button'); button.type='button';button.className='card-button lfr-reveal';
        const folderIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
        folderIcon.setAttribute('viewBox','0 0 24 24');folderIcon.setAttribute('aria-hidden','true');folderIcon.setAttribute('focusable','false');
        folderIcon.setAttribute('fill','none');folderIcon.setAttribute('stroke','currentColor');folderIcon.setAttribute('stroke-width','1.8');folderIcon.setAttribute('stroke-linejoin','round');
        const outline=document.createElementNS('http://www.w3.org/2000/svg','path');outline.setAttribute('d','M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z');folderIcon.append(outline);button.append(folderIcon);
        button.title='エクスプローラーでファイルを選択';button.setAttribute('aria-label',button.title);
        button.addEventListener('click',async event=>{
          event.preventDefault();event.stopPropagation();button.disabled=true;
          try {
            const response=await fetch(new URL('model-folder-flow/reveal',baseUrl),{
              method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Model-Folder-Flow':'1'},
              body:JSON.stringify({kind:match[1].toLowerCase(),path:card.dataset.sortPath})
            });
            if (!response.ok) throw new Error();
            button.title='エクスプローラーでファイルを選択';
          } catch (_) {button.title='エクスプローラーでの表示を確認できませんでした。もう一度お試しください';}
          finally {button.disabled=false;button.setAttribute('aria-label',button.title);}
        });
        card.classList.add('lfr-reveal-host');
        let actions=card.querySelector('.button-row');
        if(!actions){actions=document.createElement('div');actions.className='button-row';card.append(actions);}
        actions.classList.add('lfr-actions');actions.prepend(button);
      }
    }
  }
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }
  function findPath(query, paths) {
    const q = normalize(query);
    if (!q) return '';
    if (paths.has(q)) return q;
    const candidates = [...paths.keys()].filter(p => p && q.endsWith('/' + p));
    // Tree search may prepend the LoRA root; prefer the longest exact suffix.
    candidates.sort((a,b) => b.length - a.length);
    return candidates[0] || null;
  }
  function mount(source, buttons, input) {
    let state = mounted.get(source);
    const signature = buttons.map(b => b.textContent.trim()).join('\0');
    if (state && state.signature === signature && state.input === input && buttons.every((b,i)=>b===state.buttons[i])) { state.render(); return; }
    if (state) { state.saveScroll();state.disconnectRows();clearCards(state.input); state.bar.remove(); state.input.removeEventListener('input', state.render); mounted.delete(source); source.classList.remove('lfr-native'); }
    const paths = new Map();
    for (const button of buttons) {
      const path = button.classList.contains('search-all') ? '' : normalize(button.textContent);
      if (paths.has(path)) return; // Ambiguous native entries: leave original UI alone.
      paths.set(path, button);
    }
    if (![...paths.keys()].some(p => p.includes('/'))) {
      source.classList.remove('lfr-native'); mounted.delete(source); return;
    }
    let offsets=scrollPositions.get(input.id);
    if(!offsets){offsets=new Map();scrollPositions.set(input.id,offsets);}
    for(const parent of offsets.keys()) if(parent && !paths.has(parent)) offsets.delete(parent);
    const bar = document.createElement('div');
    bar.className = 'lfr-bar lfr-sticky'; bar.setAttribute('aria-label', 'Model folders');
    source.before(bar);
    let rowObservers=[];
    function disconnectRows(){rowObservers.forEach(observer=>observer.disconnect());rowObservers=[];}
    function saveScroll(){
      for(const row of bar.querySelectorAll('.lfr-row')) {
        // A hidden tab can report zero dimensions/position: do not lose its state.
        if(row.clientWidth>0 || row.scrollLeft!==0) offsets.set(row.dataset.parent,row.scrollLeft);
      }
    }
    function restoreRow(row,parent){
      const desired=offsets.get(parent)||0;
      let pending=true;
      function restore(){
        if(!row.isConnected)return;
        row.scrollLeft=desired;
        if(row.clientWidth>0){pending=false;observer?.disconnect();}
      }
      let observer=null;
      if(typeof ResizeObserver==='function'){
        observer=new ResizeObserver(()=>{if(pending)restore();});observer.observe(row);rowObservers.push(observer);
      }
      row.addEventListener('scroll',()=>{
        if(!pending && row.clientWidth>0) offsets.set(parent,row.scrollLeft);
      },{passive:true});
      restore();
      requestAnimationFrame(()=>{if(pending)restore();});
    }
    function alignSettings(top,settings,gear,row){
      const folder=row.querySelector('.lfr-button');
      if(!folder)return;
      const align=()=>{
        if(!top.isConnected)return;
        const target=folder.getBoundingClientRect(),control=gear.getBoundingClientRect();
        if(!target.height || !control.height)return; // Hidden tab: measure on reveal.
        const offset=target.top-top.getBoundingClientRect().top+(target.height-control.height)/2;
        const value=Math.round(offset*100)/100+'px';
        if(settings.style.marginTop!==value)settings.style.marginTop=value;
      };
      if(typeof ResizeObserver==='function'){
        const observer=new ResizeObserver(align);
        observer.observe(row);observer.observe(folder);observer.observe(gear);rowObservers.push(observer);
      }
      align();requestAnimationFrame(align);
    }
    let last = null;
    let options = [];
    function render() {
      const active = findPath(input.value, paths);
      filterCards(input, paths, active);
      for (const option of options) {
        option.setAttribute('aria-checked', String(option.dataset.scope === scope));
        option.tabIndex = option.dataset.scope === scope ? 0 : -1;
      }
      if (active === last && bar.childElementCount) return;
      last = active;
      saveScroll();disconnectRows();
      bar.replaceChildren();
      const top = document.createElement('div'); top.className = 'lfr-top';
      const settings = document.createElement('div'); settings.className = 'lfr-settings';
      const gear = document.createElement('button');gear.type='button';gear.className='lfr-settings-toggle';gear.setAttribute('aria-expanded','false');
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','24');icon.setAttribute('height','24');
      icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');
      icon.setAttribute('stroke-linecap','round');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
      for(const data of ['M19.95 11.37 Q20.00 12.00 20.94 12.78 Q21.88 13.56 21.39 15.05 Q20.91 16.54 19.69 16.62 Q18.47 16.70 18.06 17.18 Q17.66 17.66 17.77 18.87 Q17.88 20.09 16.48 20.80 Q15.09 21.51 14.17 20.71 Q13.25 19.90 12.63 19.95 Q12.00 20.00 11.22 20.94 Q10.44 21.88 8.95 21.39 Q7.46 20.91 7.38 19.69 Q7.30 18.47 6.82 18.06 Q6.34 17.66 5.13 17.77 Q3.91 17.88 3.20 16.48 Q2.49 15.09 3.29 14.17 Q4.10 13.25 4.05 12.63 Q4.00 12.00 3.06 11.22 Q2.12 10.44 2.61 8.95 Q3.09 7.46 4.31 7.38 Q5.53 7.30 5.94 6.82 Q6.34 6.34 6.23 5.13 Q6.12 3.91 7.52 3.20 Q8.91 2.49 9.83 3.29 Q10.75 4.10 11.37 4.05 Q12.00 4.00 12.78 3.06 Q13.56 2.12 15.05 2.61 Q16.54 3.09 16.62 4.31 Q16.70 5.53 17.18 5.94 Q17.66 6.34 18.87 6.23 Q20.09 6.12 20.80 7.52 Q21.51 8.91 20.71 9.83 Q19.90 10.75 19.95 11.37 Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0']) {
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',data);icon.append(path);
      }
      gear.append(icon);
      gear.setAttribute('aria-label', 'Model Folder Flow 設定'); gear.title = 'Model Folder Flow';
      const panel = document.createElement('div');panel.className='lfr-panel';panel.hidden=true;
      gear.addEventListener('click',()=>{panel.hidden=!panel.hidden;gear.setAttribute('aria-expanded',String(!panel.hidden));});
      panel.setAttribute('role','radiogroup');panel.setAttribute('aria-label','モデルの表示範囲');
      const heading=document.createElement('div');heading.className='lfr-heading';heading.textContent='モデルの表示範囲';panel.append(heading);
      options=[];
      for (const [value,text] of [['direct','直下のモデルのみ'],['descendants','子孫フォルダ含む']]) {
        const option=document.createElement('button');option.type='button';option.className='lfr-option';
        option.setAttribute('role','radio');option.dataset.scope=value;option.textContent=text;
        option.setAttribute('aria-checked',String(value===scope));option.tabIndex=value===scope?0:-1;
        option.addEventListener('click',()=>setScope(value));
        option.addEventListener('keydown',event=>{
          const index=options.indexOf(option);
          let next;
          if(['ArrowRight','ArrowDown'].includes(event.key)) next=(index+1)%options.length;
          else if(['ArrowLeft','ArrowUp'].includes(event.key)) next=(index+options.length-1)%options.length;
          else if(event.key==='Home') next=0;
          else if(event.key==='End') next=options.length-1;
          if(next!==undefined){event.preventDefault();setScope(options[next].dataset.scope);options[next].focus();}
          // Enter and Space use the native button activation.
        });
        options.push(option);panel.append(option);
      }
      settings.append(gear,panel);top.append(settings);bar.append(top);
      settings.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();panel.hidden=true;gear.setAttribute('aria-expanded','false');gear.focus();}});
      // Free text is left unchanged; folder navigation starts at its root.
      const selected = active || '';
      const ancestors = selected ? selected.split('/') : [];
      const levels = [''];
      for (let i=1;i<=ancestors.length;i++) levels.push(ancestors.slice(0,i).join('/'));
      for (const parent of levels) {
        const entries = [...paths].filter(([p]) => p && (p.includes('/') ? p.slice(0,p.lastIndexOf('/')) : '') === parent);
        if (!entries.length && parent) continue;
        const row = document.createElement('div'); row.className='lfr-row';row.dataset.parent=parent;
        if (!parent && paths.has('')) entries.unshift(['', paths.get('')]);
        for (const [path, original] of entries) {
          const button = document.createElement('button'); button.type='button';
          button.className = original.className.replace(/\bsearch-all\b/g, '').trim() + ' lfr-button';
          button.textContent = path ? path.split('/').pop() : original.textContent.trim();
          button.title = path || original.textContent.trim();
          const isActive = path === selected || (path && selected.startsWith(path + '/'));
          button.setAttribute('aria-pressed', String(!!isActive));
          button.addEventListener('click', () => { original.click(); render(); });
          row.append(button);
        }
        enableDrag(row);
        if (!parent) top.prepend(row); else bar.append(row);
        restoreRow(row,parent);
        if(!parent)alignSettings(top,settings,gear,row);
      }
    }
    state = {signature, buttons, bar, input, render, saveScroll, disconnectRows};
    mounted.set(source, state); source.classList.add('lfr-native');
    input.addEventListener('input', render); render();
  }
  function enableDrag(row) {
    let drag=null, suppressClick=false;
    row.addEventListener('pointerdown', e => {
      if(e.pointerType !== 'mouse' || e.button !== 0 || row.scrollWidth <= row.clientWidth) return;
      drag={id:e.pointerId,x:e.clientX,left:row.scrollLeft,moved:false};
    });
    row.addEventListener('pointermove', e => {
      if(!drag || e.pointerId!==drag.id) return;
      const delta=e.clientX-drag.x;
      if(!drag.moved && Math.abs(delta)<6) return;
      if(!drag.moved) {drag.moved=true;row.setPointerCapture(e.pointerId);row.classList.add('lfr-dragging');}
      e.preventDefault(); row.scrollLeft=drag.left-delta;
    });
    function end() {
      if(!drag) return;
      suppressClick=drag.moved;
      if(row.hasPointerCapture(drag.id)) row.releasePointerCapture(drag.id);
      drag=null;row.classList.remove('lfr-dragging');
      setTimeout(()=>{suppressClick=false;},0);
    }
    row.addEventListener('pointerup',end);
    row.addEventListener('pointercancel',end);
    row.addEventListener('lostpointercapture',end);
    row.addEventListener('pointerleave',()=>{if(drag&&!drag.moved)drag=null;});
    row.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  }
  function scan() {
    const root = app();
    installReveal(root);
    for (const [source,state] of mounted) if (!source.isConnected || !state.input.isConnected) {state.saveScroll();state.disconnectRows();clearCards(state.input);source.classList.remove('lfr-native');state.bar.remove();state.input.removeEventListener('input',state.render);mounted.delete(source);}
    // Find native folder handlers rather than depending on translated labels.
    const groups = new Map();
    for (const button of root.querySelectorAll('button[onclick*="extraNetworksSearchButton"]')) {
      if (button.closest('.lfr-bar')) continue;
      const call = button.getAttribute('onclick').match(/extraNetworksSearchButton\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
      if (!call || !['lora','textual_inversion','checkpoints'].includes(call[2].toLowerCase())) continue;
      const input = root.querySelector('#' + CSS.escape(call[1]+'_'+call[2]+'_extra_search'));
      if (!input) continue;
      const source=button.parentElement;
      if (![...source.children].every(el => el.tagName==='BUTTON')) continue;
      if (!groups.has(source)) groups.set(source, {buttons:[], input});
      groups.get(source).buttons.push(button);
    }
    for (const [source,group] of groups) {source.classList.add('lfr-sticky');mount(source, group.buttons, group.input);}
  }
  const style=document.createElement('style');
  style.textContent='.lfr-sticky{position:sticky;top:0;z-index:3;background:var(--background-fill-primary,Canvas)}.lfr-bar.lfr-sticky{padding-block:6px;box-sizing:border-box}.extra-network-dirs.lfr-sticky{background:var(--background-fill-secondary,Canvas)}.lfr-reveal-host{position:relative}.lfr-actions{max-width:100%;align-items:center}.lfr-actions:focus-within{visibility:visible!important}.lfr-actions .lfr-reveal.card-button{position:static;display:inline-flex;align-items:center;justify-content:center;min-width:0!important;min-height:0!important;margin:0;border:0;background:transparent!important;color:inherit;border-radius:4px;cursor:pointer;box-sizing:content-box;flex-shrink:1}.lfr-actions .lfr-reveal.card-button{color:#fff!important}.lfr-actions .lfr-reveal.card-button svg,.lfr-actions .lfr-reveal.card-button svg path{color:#fff!important;stroke:#fff!important;fill:none!important;pointer-events:none}.lfr-actions .lfr-reveal.card-button:hover,.lfr-actions .lfr-reveal.card-button:focus-visible{color:#f00!important}.lfr-actions .lfr-reveal.card-button:hover svg,.lfr-actions .lfr-reveal.card-button:hover svg path,.lfr-actions .lfr-reveal.card-button:focus-visible svg,.lfr-actions .lfr-reveal.card-button:focus-visible svg path{color:#f00!important;stroke:#f00!important}.lfr-actions .lfr-reveal.card-button:active svg{transform:scale(.92)}.lfr-actions .lfr-reveal.card-button:disabled{opacity:.65;cursor:wait}.lfr-reveal svg{width:1em;height:1em;flex-shrink:0;filter:drop-shadow(2px 2px 2px #000)}.lfr-reveal:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.lfr-excluded{display:none!important}.lfr-top{display:flex;min-width:0;gap:6px;align-items:flex-start}.lfr-top>.lfr-row{flex:1 1 0;min-width:0}.lfr-settings{position:relative;flex:0 0 42px;align-self:flex-start;z-index:5}.lfr-settings .lfr-settings-toggle{list-style:none;display:flex;align-items:center;justify-content:center;cursor:pointer;text-align:center;line-height:1;font-size:24px;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;padding:0!important;margin:0!important;box-sizing:border-box;border:0;border-radius:8px;color:inherit;background:transparent}.lfr-settings .lfr-settings-toggle::-webkit-details-marker{display:none}.lfr-settings .lfr-settings-toggle::marker{content:""}.lfr-settings .lfr-settings-toggle::before,.lfr-settings .lfr-settings-toggle::after{display:none;content:none}.lfr-settings .lfr-settings-toggle>svg{position:static!important;display:block!important;width:24px!important;height:24px!important;flex:0 0 24px;margin:0!important;transform:none!important;inset:auto!important;vertical-align:middle}.lfr-panel[hidden]{display:none!important}.lfr-panel{position:absolute;right:0;top:calc(100% + 6px);display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--border-color-primary,#cbd5e1);border-radius:10px;background:var(--background-fill-primary,#fff);color:var(--body-text-color,#1f2937);width:300px;max-width:calc(100vw - 40px);box-sizing:border-box;box-shadow:0 8px 24px #0003}.dark .lfr-panel{background:var(--background-fill-primary,#111827);color:var(--body-text-color,#f3f4f6);border-color:var(--border-color-primary,#475569)}.lfr-heading{font-size:13px;padding:4px 8px}.lfr-settings .lfr-option{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-width:0!important;min-height:42px;margin:0;padding:8px;border:1px solid transparent;border-radius:6px;background:transparent!important;color:inherit!important;text-align:left;white-space:normal;line-height:1.4;font:inherit;cursor:pointer}.lfr-option::before{content:"";flex:0 0 14px;width:14px;height:14px;border:1px solid currentColor;border-radius:50%;box-sizing:border-box}.lfr-option[aria-checked="true"]::before{background:currentColor;box-shadow:inset 0 0 0 3px var(--background-fill-primary,#fff)}.dark .lfr-option[aria-checked="true"]::before{box-shadow:inset 0 0 0 3px var(--background-fill-primary,#111827)}.lfr-settings .lfr-option:hover{border-color:currentColor}.lfr-settings .lfr-option:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.lfr-settings .lfr-settings-toggle:hover{background:var(--background-fill-secondary,#80808020)}.lfr-bar{min-width:0}.lfr-settings .lfr-settings-toggle:focus-visible{outline:2px solid var(--color-accent,#aaa)}.lfr-native{display:none!important}.lfr-bar{display:flex;flex-direction:column;gap:6px;width:100%;margin-bottom:8px}.lfr-row{display:flex;flex-wrap:nowrap;gap:6px;align-items:center;overflow-x:auto;max-width:100%;scrollbar-width:thin;overscroll-behavior-x:contain}.lfr-row+.lfr-row{padding-top:6px;border-top:1px solid var(--border-color-primary,#444)}.lfr-button{flex:0 0 auto!important;min-width:0!important}.lfr-button[aria-pressed="true"]{outline:1px solid var(--color-accent,#aaa);outline-offset:-1px}.lfr-row{cursor:grab}.lfr-dragging{cursor:grabbing;user-select:none}.lfr-button:focus-visible{outline:2px solid var(--color-accent,#aaa);outline-offset:2px}';
  document.head.append(style);
  // Observe only DOM structure, not hover/style changes or our own render.
  const observer=new MutationObserver(records => {
    if (records.some(r => !r.target.closest?.('.lfr-bar') && [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1 && !n.classList?.contains('lfr-bar')))) schedule();
  });
  const start=()=>{observer.observe(app(),{childList:true,subtree:true});schedule();};
  if (typeof onUiLoaded==='function') onUiLoaded(start);
  else if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  if(typeof onUiUpdate==='function') onUiUpdate(schedule);
})();
