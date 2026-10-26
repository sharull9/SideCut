export const TRANSCRIPTION_MODEL = "Xenova/whisper-tiny";
export const TRANSCRIPTION_REVISION = "5332fcc35e32a33b86612b9a57a89be7906102b1";
export const TRANSCRIPTION_LANGUAGES =
  "af,am,ar,as,az,ba,be,bg,bn,bo,br,bs,ca,cs,cy,da,de,el,en,es,et,eu,fa,fi,fo,fr,gl,gu,haw,ha,he,hi,hr,ht,hu,hy,id,is,it,ja,jw,ka,kk,km,kn,ko,la,lb,ln,lo,lt,lv,mg,mi,mk,ml,mn,mr,ms,mt,my,ne,nl,nn,no,oc,pa,pl,ps,pt,ro,ru,sa,sd,si,sk,sl,sn,so,sq,sr,su,sv,sw,ta,te,tg,th,tk,tl,tr,tt,uk,ur,uz,vi,yi,yo,zh".split(
    ",",
  );
export function transcriptionLanguage(locale: string) {
  const language = locale.trim().toLowerCase().split(/[-_]/)[0]!;
  if (!TRANSCRIPTION_LANGUAGES.includes(language))
    throw new Error(
      `Unsupported transcription language: ${locale}. Choose a supported language code.`,
    );
  return language;
}
export function transcriptVersion(language = "en") {
  return `transcript:3:${TRANSCRIPTION_MODEL}:${TRANSCRIPTION_REVISION}:q8:word:${transcriptionLanguage(language)}`;
}
