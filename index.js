const fs = require('fs-extra')
const path = require("path")
const express = require("express")
const fluent_ffmpeg = require("fluent-ffmpeg");
const uuid = require("uuid")
const gaxios = require("gaxios")
const helmet = require('helmet')

const { PassThrough } = require("stream");
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const yaml = require('yaml');

fluent_ffmpeg.setFfmpegPath(ffmpegPath)
//fluent_ffmpeg.setFfmpegPath("C:\\Users\\bloxx\\OneDrive\\Desktop\\suite\\local64\\bin-video\\ffmpeg.exe")

const app = express()

app.use(helmet())

let settings
let settingsPath

let connections = {}

function doFfmpeg(req, res, pipe, vcodec, acodec, abitrate, vbitrate, resolution, format) {
    const connection = connections[req.params.id]

    if (connection) {
        let NewFfmpeg = fluent_ffmpeg(connection.path)
            .format(format)
            .outputOptions(["-movflags", "frag_keyframe+empty_moov+faststart"])
            .addOption(["-preset", connection.preset])
            .addOption(["-vsync", "1"])
            .addOption(["-pix_fmt", "yuv420p"])
            .addOption(["-sn"])
            .addOption(["-b:v", `${vbitrate}M`])
            .addOption(["-b:a", `${abitrate}k`])
            .addOption(["-max_muxing_queue_size", "1024"])
            .audioCodec(acodec)
            .videoCodec(vcodec)

        if (resolution !== "Copy") {
            NewFfmpeg.addOption(["-vf", `scale=${resolution.split("x").join(":")}`])
        }

        if (req.query.time) {
            if (!(["tv"].includes(connection.type))) {
                NewFfmpeg.addInputOption(["-ss", req.query.time])
            }
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
                console.log(err)
            })

        NewFfmpeg.pipe(pipe, { end: true })
    } else {
        res.sendStatus(404)
    }
}

app.get("/settings/:path", async (req, res) => {
    settingsPath = req.params.path
    settings = yaml.parse(fs.readFileSync(path.join(settingsPath, 'settings.yaml'), "utf-8"))
})

app.get("/transcode/:id", async (req, res) => {
    const connection = connections[req.params.id]

    if (connection.output) {
        let Stream = new PassThrough()

        Stream.pipe(res, { end: true })

        if (connection.record) {
            let name = fs.readdirSync(path.join(settings.media, "dvr"), "utf-8").length
            let stream = fs.createWriteStream(path.join(settings.media, "dvr", `${name + 1}.mkv`))

            Stream.pipe(stream, { end: true })
        }

        Stream.on("finish", () => {
            connection.streams.forEach((value, index) => {
                value.kill()
            })

            delete connections[req.params.id]
        })

        Stream.on("end", () => {
            connection.streams.forEach((value, index) => {
                value.kill()
            })

            delete connections[req.params.id]
        })

        doFfmpeg(req, res, Stream, connection.vcodec, connection.acodec, connection.abitrate, connection.vbitrate, connection.resolution, settings.ffmpeg_VideoFormat)
    }
})

app.get("/connection", async (req, res) => {
    const id = uuid.v4().split("-").join("")
    let video_path
    let url = false
    let metadata_path = path.join(settings.metadata, req.query.name, "metadata.json")

    switch (req.query.type) {
        case "movies":
            var metadata = fs.readJsonSync(metadata_path)
            video_path = metadata.file_name
            break;
        case "series":
            var metadata = fs.readJsonSync(metadata_path).seasons[req.query.season].episodes
            var result = Object.keys(metadata).map((key) => [key, metadata[key]])
            video_path = ((result.find(element => element[0].includes(req.query.episode)))[1]).file_name
            break;
        case "dvr":

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
                                url = true
                            }
                        })
                        break
                }
            }
            break;
        default:

            break;
    }

    fs.pathExists(video_path, (err, exists) => {
        if (err) {
            return console.log(err)
        }
        if (exists || url) {
            connections[id] = {
                streams: [],
                resolution: req.query.resolution,
                output: req.query.output,
                record: req.query.record_dvr,
                type: req.query.type,
                path: video_path,
                vcodec: req.query.video_codec,
                acodec: req.query.audio_codec,
                preset: req.query.preset,
                abitrate: req.query.abitrate,
                vbitrate: req.query.vbitrate,
            }
            res.send(id)
        } else {
            res.sendStatus(404)
        }
    })
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

        res.sendStatus(204)
        delete connections[req.params.id]
    } else {
        res.sendStatus(404)
    }
})

app.listen(5391)