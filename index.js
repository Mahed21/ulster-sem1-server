const express = require("express");
require("dotenv").config();
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");
const cors = require("cors");
const multer = require("multer");
const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pszjp.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function run() {
  try {
    await client.connect();
    const database = client.db("tiktok");
    const videoCollection = database.collection("videoDetails");
    const bucket = new GridFSBucket(database, { bucketName: "videos" });

    console.log("Connected to MongoDB");

    // Configure multer for file upload
    const storage = multer.memoryStorage();
    const upload = multer({ storage });

    // Endpoint to upload video details and video file
    app.post("/videoDetails", upload.single("videoFile"), async (req, res) => {
      try {
        const { title, description } = req.body;
        const videoFile = req.file;

        if (!videoFile) {
          return res
            .status(400)
            .json({ success: false, message: "No file uploaded" });
        }

        // Store the video file in GridFS
        const uploadStream = bucket.openUploadStream(videoFile.originalname, {
          contentType: videoFile.mimetype,
          metadata: { title, description },
        });

        // Pipe the buffer to GridFS upload stream
        uploadStream.write(videoFile.buffer, (err) => {
          if (err) {
            console.error("Error uploading file:", err);
            return res
              .status(500)
              .json({ success: false, message: "Server error during upload" });
          }
        });

        uploadStream.end(async () => {
          const file = await database
            .collection("videos.files")
            .findOne({ filename: videoFile.originalname });

          if (!file) {
            return res.status(500).json({
              success: false,
              message: "File not found in database after upload",
            });
          }

          // Save file details to the videoDetails collection with HTTP link
          const videoDetails = {
            title,
            description,
            fileId: file._id,
            filename: file.filename,
            uploadDate: file.uploadDate,
            videoUrl: `http://localhost:${port}/videos/${file._id}`, // Store HTTP link
          };
          const result = await videoCollection.insertOne(videoDetails);

          res.json({
            success: true,
            message: "Video uploaded successfully",
            data: result,
          });
        });
      } catch (error) {
        console.error("Error uploading video:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Endpoint to get all video details
    app.get("/videoDetails", async (req, res) => {
      try {
        const videos = await videoCollection.find({}).toArray();
        res.json(videos);
      } catch (error) {
        console.error("Error fetching videos:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });
    app.get("/videoDetails/:id", async (req, res) => {
      try {
        const fileId = new ObjectId(req.params.id);
        const bucket = new GridFSBucket(client.db("tiktok"), {
          bucketName: "videos",
        });

        // Find the file metadata to get its content type
        const file = await client
          .db("tiktok")
          .collection("videos.files")
          .findOne({ _id: fileId });

        if (!file) {
          return res
            .status(404)
            .json({ success: false, message: "Video not found" });
        }

        // Set the Content-Type header to match the file type
        res.set("Content-Type", file.contentType);

        // Stream the video to the response
        const downloadStream = bucket.openDownloadStream(fileId);
        downloadStream.on("error", (err) => {
          res.status(404).json({ success: false, message: "Video not found" });
        });
        downloadStream.pipe(res);
      } catch (error) {
        console.error("Error streaming video:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
