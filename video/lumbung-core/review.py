"""Review the actual encoded output, not only source stills."""
import argparse
import json
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument("file")
args=parser.parse_args()
path=Path(args.file).resolve()
info=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)]))
video=next(s for s in info['streams'] if s['codec_type']=='video')
assert video['codec_name']=='h264'
assert video['pix_fmt']=='yuv420p'
assert abs(float(video['duration'])-60)<.05
audio=[s for s in info['streams'] if s['codec_type']=='audio']
for stream in audio:
    assert stream['codec_name']=='aac'
    assert stream['channels']==2
    assert abs(float(stream['duration'])-60)<.08
subprocess.run(["ffmpeg","-v","error","-i",str(path),"-f","null","-"],check=True)

qa=ROOT/"previews"/path.stem
qa.mkdir(parents=True,exist_ok=True)
subprocess.run(["ffmpeg","-v","error","-y","-i",str(path),"-vf","fps=1,scale=480:270","-start_number","0",str(qa/"second-%02d.png")],check=True)
frames=sorted(qa.glob('second-*.png'))
assert len(frames)==60,len(frames)
font=ImageFont.truetype(str(ROOT/'assets/Geist-Regular.ttf'),20)
dark=[]
for sheet_no in range(3):
    sheet=Image.new('RGB',(1920,5*310),(12,12,12))
    draw=ImageDraw.Draw(sheet)
    for i,frame in enumerate(frames[sheet_no*20:(sheet_no+1)*20]):
        picture=Image.open(frame).convert('RGB')
        array=np.asarray(picture)
        bright=float(np.mean(array.max(axis=2)>90))
        if bright<.0005: dark.append(frame.name)
        x=(i%4)*480;y=(i//4)*310
        draw.text((x+12,y+7),f'{sheet_no*20+i:02d}s',font=font,fill='white')
        sheet.paste(picture,(x,y+36))
    sheet.save(qa/f'timeline-{sheet_no+1}.jpg',quality=94)
assert not dark,f'Unexpected blank or unreadable frames: {dark}'
motion={}
for start,end in [(0,3),(16,19),(30,32),(38,41),(51,54),(57,59)]:
    a=np.asarray(Image.open(frames[start]).convert('RGB')).astype(float)
    b=np.asarray(Image.open(frames[end]).convert('RGB')).astype(float)
    delta=float(np.mean(np.abs(a-b)))
    assert delta>.1,(start,end,delta)
    motion[f'{start}-{end}']=round(delta,3)
report={
    'file':path.name,'duration_seconds':float(video['duration']),
    'width':video['width'],'height':video['height'],'fps':video['r_frame_rate'],
    'frames':video.get('nb_frames'),'video_codec':video['codec_name'],'audio_streams':len(audio),
    'full_decode':'passed','contact_sheet_samples':len(frames),
    'blank_frame_check':'passed','motion_samples_mean_pixel_difference':motion,
    'audio_listening_review':'not_performed; visual and technical inspection available',
}
(qa/'technical-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
