const fs = require('fs-extra')
const path = require("path")
const express = require("express")
const fluent_ffmpeg = require("fluent-ffmpeg");
const uuid = require("uuid")
const gaxios = require("gaxios")

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { parse: YamlParse } = require('yaml');

fluent_ffmpeg.setFfmpegPath(ffmpegPath)
//fluent_ffmpeg.setFfmpegPath("C:\\Users\\bloxx\\OneDrive\\Desktop\\suite\\local64\\bin-video\\ffmpeg.exe")

const app = express()
app.disable('x-powered-by')

let settings = YamlParse(fs.readFileSync(path.join("C:\\Users\\bloxx\\OneDrive\\Desktop\\Development\\newJukebox", 'settings.yaml'), "utf-8"))

function getChildfromParent(parentDir, includes) {
    let results = []

    for (const [index, value] of fs.readdirSync(parentDir).entries()) {
        if (value.includes(includes)) {
            results.push(value)
        }
    }

    return results
}

let connections = {}

function doFfmpeg(req, res, pipe, vcodec, acodec, format, noVideo, noAudio) {
    const connection = connections[req.params.id]

    let NewFfmpeg = fluent_ffmpeg(connection.path)
        .format(format)
        .outputOptions(["-movflags", "frag_keyframe+empty_moov+faststart"])
        .addOption(["-preset", connection.preset])
        .addOption("-sn")

    if (req.query.time) {
        if (!(["tv"].includes(connection.type))) {
            NewFfmpeg.addInputOption(["-ss", req.query.time])
        }
    }

    if (noAudio) {
        if (!(["tv"].includes(connection.type))) {
            NewFfmpeg.noAudio()
        }
    } else {
        if (acodec !== "copy") {
            NewFfmpeg.audioCodec(acodec)
        }
    }

    if (noVideo) {
        if (!(["tv"].includes(connection.type))) {
            NewFfmpeg.noVideo()
        }
    } else {
        if (vcodec !== "copy") {
            NewFfmpeg.videoCodec(vcodec)
        }
    }

    if (req.query.resolution) {
        NewFfmpeg.addOption(["-vf", `scale=2:${req.query.resolution}`])
    }

    connections[req.params.id].streams.push(NewFfmpeg)

    NewFfmpeg.on("end", () => { })
        .on("error", (err) => {
            err = err.toString()

            if (!err.includes("Output stream closed")) {
                if (!err.includes("SIGKILL")) {
                    console.log(err)
                }
            }
        }).on("close", () => {

        })
        .on("stderr", (err) => {
            //console.log(err)
        })

    NewFfmpeg.pipe(pipe, { end: true })
}

app.get("/transcode/:id", async (req, res) => {
    const connection = connections[req.params.id]

    if (connection.output) {
        let noVideo = connection.novideo
        let noAudio = connection.noaudio
        if (connection.copy) {
            doFfmpeg(req, res, res, "copy", "copy", settings.ffmpeg_VideoFormat, noVideo, noAudio)
        } else {
            doFfmpeg(req, res, res, connection.vcodec, connection.acodec, settings.ffmpeg_VideoFormat, noVideo, noAudio)
        }
    }

    if (connection.record) {
        let name = fs.readdirSync(path.join(settings.media, "dvr"), "utf-8").length
        let stream = fs.createWriteStream(path.join(settings.media, "dvr", `${name}.mkv`))

        doFfmpeg(req, res, stream, "copy", connection.acodec, "matroska")
    }
})

app.get("/connection", async (req, res) => {
    const id = uuid.v4().split("-").join("")
    let video_path

    switch (req.query.type) {
        case "movies":
            video_path = path.join(settings.media, "movies", req.query.name, fs.readdirSync(video_path, "utf-8")[0])
            break;
        case "series":
            video_path = path.join(settings.media, "series", req.query.name, req.query.season)
            video_path = path.join(video_path, getChildfromParent(video_path, `E${req.query.episode}`)[0])
            break;
        case "dvr":
            video_path = path.join(settings.media, "series", req.query.name, req.query.season)
            video_path = path.join(video_path, getChildfromParent(video_path, req.query.name.toString())[0])
            break;
        case "tv":
            for (let tuner of settings.tv_tuners) {
                switch (tuner.type) {
                    case "tvheadend":
                        let response = await gaxios.request({ method: "GET", url: `${tuner.ip}/api/channel/grid?` })
                        response = response.data

                        response.entries.forEach((value, index) => {
                            if (value.name.toLowerCase() == req.query.name.toLowerCase()) {
                                video_path = `${tuner.ip}/stream/channel/${value.uuid}`
                            }
                        })
                        break
                }
            }
            break;
        default:

            break;
    }

    connections[id] = { streams: [], noaudio: req.query.noaudio, novideo: req.query.novideo, copy: req.query.copy, output: req.query.output, record: req.query.record_dvr, type: req.query.type, path: video_path, vcodec: req.query.video_codec, acodec: req.query.audio_codec, preset: req.query.preset }
    res.send(id)
})

app.get("/ping", (req, res) => {
    res.sendStatus(200)
})

app.delete("/remove/:id", (req, res) => {
    let connection = connections[req.params.id]
    if (connection) {
        let streams = connection.streams

        streams.forEach((value, index) => {
            value.kill()
        })

        delete connections[req.params.id]
    }

    res.sendStatus(204)
})

app.listen(5391)