#!/usr/bin/env bash
# Encode a source video into a web-ready channel loop:
#   <out>.mp4  H.264/AAC  (Safari, iOS, everything)
#   <out>.webm VP9/Opus   (fallback for browsers without H.264, e.g. open-source Chromium)
#   <out>.jpg  poster frame (shown instantly while the video buffers)
#
# Usage:
#   scripts/encode-video.sh <input> <out-path-without-ext> [options]
#
# Options:
#   --start <sec>       start time in the source            (default 0)
#   --duration <sec>    length to take from the source       (default: whole file)
#   --loop-fade <sec>   cross-fade the end into the start so the loop is seamless (default 0 = off)
#   --vf <filters>      extra ffmpeg video filters, applied before scaling (e.g. a grade)
#   --audio <file>      replace the soundtrack with this file (trimmed/padded to fit)
#   --mute              strip audio
#   --width <px>        output width, 16:9                    (default 1280)
#   --poster-at <sec>   poster frame time in the output       (default 1/3 of the way in)
#   --fit <cover|contain>  crop to 16:9 or letter/pillarbox   (default cover)
#   --crf <n>           H.264 quality, lower = better/larger  (default 24; VP9 uses n+11)
#
# Example (your own reel):
#   scripts/encode-video.sh ~/Desktop/nike_final.mov public/media/nike-run --start 4 --duration 30 --loop-fade 0.8
set -euo pipefail

if [[ $# -lt 2 ]]; then sed -n '2,24p' "$0"; exit 1; fi
IN="$1"; OUT="$2"; shift 2
CRF=24; START=0; DUR=""; FADE=0; EXTRA_VF=""; AUDIO=""; MUTE=0; W=1280; POSTER_AT=""; FIT=cover
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START="$2"; shift 2;;
    --duration) DUR="$2"; shift 2;;
    --loop-fade) FADE="$2"; shift 2;;
    --vf) EXTRA_VF="$2"; shift 2;;
    --audio) AUDIO="$2"; shift 2;;
    --mute) MUTE=1; shift;;
    --width) W="$2"; shift 2;;
    --poster-at) POSTER_AT="$2"; shift 2;;
    --fit) FIT="$2"; shift 2;;
    --crf) CRF="$2"; shift 2;;
    *) echo "unknown option $1" >&2; exit 1;;
  esac
done
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
H=$(( (W * 9 / 16) / 2 * 2 ))
mkdir -p "$(dirname "$OUT")"

if [[ -z "$DUR" ]]; then
  SRC_LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
  DUR=$(python3 -c "print(round($SRC_LEN - $START, 3))")
fi
OUT_LEN=$(python3 -c "print(round($DUR - $FADE, 3))")
[[ -z "$POSTER_AT" ]] && POSTER_AT=$(python3 -c "print(round($OUT_LEN / 3, 2))")

if [[ "$FIT" == "contain" ]]; then
  SCALE="scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black"
else
  SCALE="scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}"
fi
PRE="trim=start=${START}:duration=${DUR},setpts=PTS-STARTPTS"
[[ -n "$EXTRA_VF" ]] && PRE="${PRE},${EXTRA_VF}"
VCHAIN="${PRE},${SCALE},fps=30,format=yuv420p"

HAS_AUDIO=0
if [[ $MUTE -eq 0 && -z "$AUDIO" ]] && ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$IN" | grep -q .; then HAS_AUDIO=1; fi

INPUTS=(-i "$IN")
if [[ "$FADE" != "0" ]]; then
  OFF=$(python3 -c "print(round($DUR - 2 * $FADE, 3))")
  FC="[0:v]${VCHAIN},split[va][vb];[va]trim=start=${FADE},setpts=PTS-STARTPTS[vm];[vb]trim=end=${FADE},setpts=PTS-STARTPTS[vh];[vm][vh]xfade=transition=fade:duration=${FADE}:offset=${OFF},format=yuv420p[v]"
  if [[ $HAS_AUDIO -eq 1 ]]; then
    FC="${FC};[0:a]atrim=start=${START}:duration=${DUR},asetpts=PTS-STARTPTS,aresample=48000,asplit[aa][ab];[aa]atrim=start=${FADE},asetpts=PTS-STARTPTS[am];[ab]atrim=end=${FADE},asetpts=PTS-STARTPTS[ah];[am][ah]acrossfade=d=${FADE}[a]"
  fi
else
  FC="[0:v]${VCHAIN}[v]"
  if [[ $HAS_AUDIO -eq 1 ]]; then
    FC="${FC};[0:a]atrim=start=${START}:duration=${DUR},asetpts=PTS-STARTPTS,aresample=48000[a]"
  fi
fi
if [[ -n "$AUDIO" ]]; then
  INPUTS+=(-i "$AUDIO")
  FC="${FC};[1:a]aresample=48000,apad,atrim=duration=${OUT_LEN},afade=t=in:d=0.03,afade=t=out:st=$(python3 -c "print(round($OUT_LEN - 0.03, 3))"):d=0.03[a]"
  HAS_AUDIO=1
fi
MAPS=(-map "[v]"); [[ $HAS_AUDIO -eq 1 ]] && MAPS+=(-map "[a]")

echo "→ ${OUT}.mp4"
ffmpeg -v error -stats -y "${INPUTS[@]}" -filter_complex "$FC" "${MAPS[@]}" -t "$OUT_LEN" \
  -c:v libx264 -pix_fmt yuv420p -preset slow -crf "$CRF" -profile:v high -level 4.0 -g 30 -keyint_min 30 -sc_threshold 0 \
  -c:a aac -b:a 128k -ac 2 -movflags +faststart "${OUT}.mp4"
echo "→ ${OUT}.webm"
ffmpeg -v error -stats -y -i "${OUT}.mp4" -map 0 -c:v libvpx-vp9 -crf "$((CRF + 11))" -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -g 30 \
  -c:a libopus -b:a 96k "${OUT}.webm"
echo "→ ${OUT}.jpg"
ffmpeg -v error -y -ss "$POSTER_AT" -i "${OUT}.mp4" -frames:v 1 -q:v 4 "${OUT}.jpg"
ls -la "${OUT}".* | awk '{print "   ", $5, $9}'
