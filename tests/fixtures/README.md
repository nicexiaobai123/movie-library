`seek.mp4` 是测试用合成样片：48 秒，480×270，H.264 Main + AAC，快启 MP4。它不是片源或站点内置数据。

生成命令（FFmpeg 仅用于制作样片，不是应用依赖）：

```shell
ffmpeg -f lavfi -i testsrc2=size=480x270:rate=24 -f lavfi -i sine=frequency=330:sample_rate=44100 -t 48 -c:v libx264 -profile:v main -pix_fmt yuv420p -preset veryfast -crf 28 -g 48 -c:a aac -b:a 48k -movflags +faststart seek.mp4
```
