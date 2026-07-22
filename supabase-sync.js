// supabase-sync.js — 図面ごとの注記(strokes/dims)をSupabaseへ自動保存・自動復元する（V1_01）
// 依存: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> をindex.htmlで先に読み込むこと
// 依存グローバル: strokes, dims, currentFileIdx, openFiles, currentFileName, currentFileSize (viewer.js/HTML)
//
// 設計方針（安全側）:
// ・ネットワークが無い/失敗しても既存のローカル保存(localStorage/IndexedDB)には一切影響を与えない
//   （すべてtry/catchで囲み、失敗時はconsole.warnのみでUIを止めない）
// ・自動保存: 既存のdoSave()実行のたびに、現在開いているファイルのstrokes/dimsを
//   Supabaseへ非同期でupsert（file_keyで1レコード）
// ・自動復元: ファイルを新しく開いた際、ローカルに注記(strokes/dims)が無い場合のみ
//   Supabaseから復元を試みる（ローカルに既にある注記をクラウドの古いデータで
//   上書きしてしまわないようにするため）

const _SB_URL='https://opuylmqrsovtemygouwe.supabase.co';
const _SB_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wdXlsbXFyc292dGVteWdvdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjM4NDMsImV4cCI6MjEwMDIzOTg0M30.cECPW5u5FCPOlmyCWGaJi_PbaizKB2vQbsmQaOJZ5bM';

let _sbClient=null;
try{
  if(window.supabase&&typeof window.supabase.createClient==='function'){
    _sbClient=window.supabase.createClient(_SB_URL,_SB_ANON_KEY);
  }
}catch(e){console.warn('[SupabaseSync] クライアント初期化失敗',e);}

// アプリ内部のfileKeyは "name\x00size" だが、PostgreSQLのtext列はNUL文字(\x00)を
// 格納できず保存が必ず失敗するため、Supabase送信専用に安全な区切り文字へ変換する
function _sbSafeKey(fk){ return (fk==null)?fk:String(fk).split('\x00').join('::'); }

// 現在のファイルの注記をSupabaseへ保存（非同期・失敗しても無視）
function _sbPushCurrentAnnotations(){
  if(!_sbClient) return;
  try{
    if(typeof currentFileIdx==='undefined'||currentFileIdx<0||!openFiles[currentFileIdx]) return;
    var _f=openFiles[currentFileIdx];
    var _fk=_sbSafeKey(_f.fileKey||(typeof _fileKey==='function'?_fileKey(currentFileName,currentFileSize):null));
    if(!_fk) return;
    _sbClient.from('dxf_annotations').upsert({
      file_key:_fk,
      file_name:currentFileName||_f.currentFileName||_f.name||'',
      strokes:strokes||[],
      dims:dims||[]
    },{onConflict:'file_key'}).then(function(res){
      if(res&&res.error) console.warn('[SupabaseSync] 保存失敗',res.error.message);
    });
  }catch(e){console.warn('[SupabaseSync] 保存例外',e);}
}

// 指定fileKeyの注記をSupabaseから取得。無い/失敗時はnullを返す
async function _sbPullAnnotations(fileKey){
  if(!_sbClient||!fileKey) return null;
  try{
    var res=await _sbClient.from('dxf_annotations')
      .select('strokes,dims')
      .eq('file_key',_sbSafeKey(fileKey))
      .maybeSingle();
    if(res.error){console.warn('[SupabaseSync] 復元失敗',res.error.message);return null;}
    return res.data||null;
  }catch(e){console.warn('[SupabaseSync] 復元例外',e);return null;}
}

window._sbPushCurrentAnnotations=_sbPushCurrentAnnotations;
window._sbPullAnnotations=_sbPullAnnotations;
