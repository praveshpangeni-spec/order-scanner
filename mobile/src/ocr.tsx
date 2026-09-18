import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
} from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

/**
 * On-device OCR engine: a hidden WebView that runs the exact same Tesseract.js
 * used by the web app. Images are passed in as base64 data URLs; recognized
 * text comes back over the WebView bridge.
 */

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>
</head><body>
<script>
  function post(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  async function handle(raw){
    var msg; try { msg = JSON.parse(raw); } catch(e){ return; }
    if(!msg || msg.type!=='ocr') return;
    try{
      var res = await Tesseract.recognize(msg.image, 'eng', {
        logger: function(m){
          if(m.status==='recognizing text') post({type:'progress', id:msg.id, progress:m.progress});
        }
      });
      post({type:'result', id:msg.id, text:(res.data && res.data.text) || ''});
    }catch(err){ post({type:'error', id:msg.id, message:String(err)}); }
  }
  // iOS delivers to window, Android to document.
  window.addEventListener('message', function(e){ handle(e.data); });
  document.addEventListener('message', function(e){ handle(e.data); });
  post({type:'ready'});
</script>
</body></html>`;

export interface OcrEngineHandle {
  recognize: (
    dataUrl: string,
    onProgress?: (p: number) => void
  ) => Promise<string>;
}

type Pending = {
  resolve: (text: string) => void;
  reject: (e: any) => void;
  onProgress?: (p: number) => void;
};

export const OcrEngine = forwardRef<OcrEngineHandle>((_props, ref) => {
  const webRef = useRef<WebView>(null);
  const pending = useRef<Map<string, Pending>>(new Map());
  const counter = useRef(0);

  const recognize = useCallback(
    (dataUrl: string, onProgress?: (p: number) => void) =>
      new Promise<string>((resolve, reject) => {
        const id = "r" + ++counter.current;
        pending.current.set(id, { resolve, reject, onProgress });
        const payload = JSON.stringify({ type: "ocr", id, image: dataUrl });
        // Post to the WebView; escape for safe injection.
        webRef.current?.injectJavaScript(
          `(function(){ handle(${JSON.stringify(payload)}); })(); true;`
        );
      }),
    []
  );

  useImperativeHandle(ref, () => ({ recognize }), [recognize]);

  const onMessage = useCallback((event: any) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!msg || !msg.id) return;
    const p = pending.current.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") p.onProgress?.(msg.progress ?? 0);
    else if (msg.type === "result") {
      pending.current.delete(msg.id);
      p.resolve(msg.text || "");
    } else if (msg.type === "error") {
      pending.current.delete(msg.id);
      p.reject(new Error(msg.message || "OCR failed"));
    }
  }, []);

  return (
    <View style={{ width: 0, height: 0, position: "absolute", opacity: 0 }}>
      <WebView
        ref={webRef}
        source={{ html: HTML }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        style={{ width: 1, height: 1 }}
      />
    </View>
  );
});

OcrEngine.displayName = "OcrEngine";
