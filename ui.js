// ui.js — UI状態管理関数
// DXF Viewer V0_63
// 依存グローバル: savedViews (var宣言)
// DOM依存: snap-hint, undoBtn, redoBtn, .mem-btn, .show-btn

// =========================================================
// ガイドメッセージ
// =========================================================
let _guideTimer = null;

function showGuide(msg, autoHideMs){
  const el = document.getElementById('snap-hint');
  if(!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  clearTimeout(_guideTimer);
  if(msg && autoHideMs) _guideTimer = setTimeout(hideGuide, autoHideMs);
}

function hideGuide(){
  const el = document.getElementById('snap-hint');
  if(el) el.style.display = 'none';
  clearTimeout(_guideTimer);
}

// =========================================================
// ビュー記憶ボタン状態更新
// =========================================================
function updateViewmemoState(i){
  const mb=document.querySelector('.mem-btn[data-vi="'+i+'"]');
  const sb=document.querySelector('.show-btn[data-vs="'+i+'"]');
  if(mb) mb.classList.toggle('vm-saved',!!savedViews[i]);
  if(sb) sb.classList.toggle('vm-saved',!!savedViews[i]);
  // V0_160: savedViewsはファイル横断のグローバル項目になったため、
  // どのファイルの記憶かを小さく表示（別ファイルを誤って開かないように）
  const vf=document.querySelector('.vm-file[data-vf="'+i+'"]');
  // V1_206: 長いファイル名はCSS側(min-width:0+text-overflow:ellipsis)で右側を省略表示する。
  // title属性にフルネームを入れておくことで、省略された場合もトラックパッド等での
  // ホバー時に全体を確認できる
  const _vfName206=(savedViews[i]&&savedViews[i].fileName)?savedViews[i].fileName:'';
  if(vf){ vf.textContent=_vfName206; vf.title=_vfName206; }
}

