#!/usr/bin/env bash
# Rebuilds the placeholder channel media in public/media/ from openly licensed sources.
# You only need this if you want to regenerate the demo footage; the encoded files are committed.
# Sources + licenses are listed in public/media/CREDITS.md.
#
# Requires: ffmpeg (with libx264, libvpx-vp9, libopus), python3, curl
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.media-cache"; OUT="$ROOT/public/media"; ENC="$ROOT/scripts/encode-video.sh"
Q=(--crf 27)  # placeholders: favour small files over pristine quality
mkdir -p "$CACHE" "$OUT"; cd "$CACHE"
RAW=https://raw.githubusercontent.com

fetch() { [[ -s "$1" ]] || { echo "↓ $1"; curl -fsSL --retry 3 -o "$1" "$2"; }; }
fetch bbb1080.mp4 "$RAW/bower-media-samples/big-buck-bunny-1080p-30s/master/video.mp4"
fetch bbb360.mp4  "$RAW/mediaelement/mediaelement-files/master/big_buck_bunny.mp4"
fetch flower.mp4  "$RAW/mdn/interactive-examples/main/live-examples/media/cc0-videos/flower.mp4"
fetch friday.mp4  "$RAW/mdn/interactive-examples/main/live-examples/media/cc0-videos/friday.mp4"
fetch water.mp4   "$RAW/mdn/interactive-examples/main/live-examples/media/examples/stream-of-water.mp4"
fetch worker.mp4  "$RAW/intel-iot-devkit/sample-videos/master/worker-zone-detection.mp4"
fetch store.mp4   "$RAW/intel-iot-devkit/sample-videos/master/store-aisle-detection.mp4"

# --- Synthesised soundtracks for the clips that ship without audio --------------------------
synth() { # name, duration, aevalsrc expression, extra audio filters
  [[ -s "$1.wav" ]] || ffmpeg -v error -y -f lavfi -i "aevalsrc='$3':s=48000:d=$2" -af "$4,loudnorm=I=-21:TP=-2:LRA=7" -ar 48000 "$1.wav"
}
synth pad 12 "0.07*(sin(2*PI*130.81*t)+0.8*sin(2*PI*196*t+0.3)+0.7*sin(2*PI*246.94*t)+0.6*sin(2*PI*293.66*t+1)+0.5*sin(2*PI*392*t))*(0.65+0.35*sin(2*PI*t/6))+0.02*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*t/3))|0.07*(sin(2*PI*130.9*t)+0.8*sin(2*PI*196.2*t)+0.7*sin(2*PI*247.1*t+0.5)+0.6*sin(2*PI*293.9*t)+0.5*sin(2*PI*391.6*t+2))*(0.65+0.35*sin(2*PI*t/6+1))+0.02*sin(2*PI*659.25*t)*(0.5+0.5*sin(2*PI*t/4))" \
  "lowpass=f=2400,aecho=0.8:0.6:120|250:0.35|0.25"
synth pulse 20 "0.55*sin(2*PI*(48*mod(t,0.5)+90*(1-exp(-25*mod(t,0.5)))/25))*exp(-7*mod(t,0.5))+0.06*(random(0)*2-1)*exp(-45*mod(t+0.25,0.5))+0.12*sin(2*PI*55*t)*(0.5+0.5*sin(2*PI*2*t))*(1-exp(-30*mod(t,0.5)))+0.035*sin(2*PI*220*t)*exp(-3*mod(t,2))" \
  "lowpass=f=6000,pan=stereo|c0=c0|c1=c0"
synth arp 20 "0.16*sin(2*PI*(if(lt(mod(t,4),2), 220*pow(2,(if(eq(mod(floor(t/0.3),4),0),0,if(eq(mod(floor(t/0.3),4),1),3,if(eq(mod(floor(t/0.3),4),2),7,12))))/12), 174.61*pow(2,(if(eq(mod(floor(t/0.3),4),0),0,if(eq(mod(floor(t/0.3),4),1),4,if(eq(mod(floor(t/0.3),4),2),7,12))))/12)))*t)*exp(-6*mod(t,0.3))+0.05*sin(2*PI*if(lt(mod(t,4),2),110,87.31)*t)" \
  "aecho=0.7:0.5:300:0.3,lowpass=f=4000,pan=stereo|c0=c0|c1=c0"
synth drive 12 "0.10*(2*mod(55*pow(2,if(lt(mod(t,8),4),0,-2)/12)*t,1)-1)*exp(-5*mod(t,0.25))+0.05*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.6+0.4*sin(2*PI*t/4))+0.4*sin(2*PI*(45*mod(t,1)+70*(1-exp(-25*mod(t,1)))/25))*exp(-8*mod(t,1))" \
  "lowpass=f=3000,aecho=0.6:0.4:180:0.25,pan=stereo|c0=c0|c1=c0"

# --- Intermediates ---------------------------------------------------------------------------
# Slow the very short clips down so the loop breathes (frame-blended, pitch-preserving audio).
[[ -s flower-slow.mp4 ]] || ffmpeg -v error -y -i flower.mp4 -vf "setpts=1.7*PTS,minterpolate=fps=30:mi_mode=blend" -an -c:v libx264 -crf 14 flower-slow.mp4
[[ -s water-slow.mp4 ]]  || ffmpeg -v error -y -i water.mp4 -vf "setpts=2*PTS,minterpolate=fps=30:mi_mode=blend" -af "atempo=0.5" -c:v libx264 -crf 14 -c:a aac -b:a 192k water-slow.mp4
[[ -s aurora.mp4 ]] || ffmpeg -v error -y -f lavfi -i "gradients=s=1280x720:r=30:d=12:c0=0x050a1f:c1=0x0fd4a8:c2=0x5b2bd6:c3=0x02040c:c4=0x1a8cff:nb_colors=5:speed=0.02:type=spiral:seed=7" \
  -vf "gblur=sigma=30,eq=contrast=1.15:saturation=1.2,noise=alls=7:allf=t+u,vignette=PI/4" -c:v libx264 -crf 14 -pix_fmt yuv420p aurora.mp4

# --- Final channel loops -----------------------------------------------------------------------
GRADE_WARM="eq=contrast=1.06:saturation=1.08,colorbalance=rs=0.04:gs=0.01:bs=-0.05:rh=0.03:bh=-0.03"
GRADE_TEAL="eq=contrast=1.12:saturation=0.9,colorbalance=rs=-0.06:bs=0.06:rh=0.06:gh=0.01:bh=-0.05,curves=preset=medium_contrast"

"$ENC" bbb1080.mp4      "$OUT/meadow"   --start 2.5 --duration 15.5 --loop-fade 0.8 "${Q[@]}"
"$ENC" flower-slow.mp4  "$OUT/lumen"    --loop-fade 0.8 --audio pad.wav --vf "eq=saturation=1.05:contrast=1.04" "${Q[@]}"
"$ENC" water-slow.mp4   "$OUT/still"    --loop-fade 0.6 --vf "eq=saturation=0.85:contrast=1.08,colorbalance=bs=0.05:bm=0.03" "${Q[@]}"
"$ENC" friday.mp4       "$OUT/standard" --start 0.1 --loop-fade 0.4 --fit contain --vf "eq=contrast=1.08" "${Q[@]}"
"$ENC" worker.mp4       "$OUT/forge"    --start 18 --duration 18.6 --loop-fade 0.6 --audio pulse.wav --vf "$GRADE_TEAL" "${Q[@]}"
"$ENC" store.mp4        "$OUT/hearth"   --start 18 --duration 16.6 --loop-fade 0.6 --audio arp.wav --vf "$GRADE_WARM" "${Q[@]}"
"$ENC" bbb360.mp4       "$OUT/burrow"   --width 960 --start 35.5 --duration 20 --loop-fade 0.8 --vf "$GRADE_WARM" "${Q[@]}"
"$ENC" aurora.mp4       "$OUT/aurora"   --duration 12 --loop-fade 1 --audio drive.wav "${Q[@]}"
echo "done → $OUT"
