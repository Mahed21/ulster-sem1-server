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
    const adminCollection = database.collection("admin");
    const bucket = new GridFSBucket(database, { bucketName: "videos" });

    console.log("Connected to MongoDB");

    // Configure multer for file upload
    const storage = multer.memoryStorage();
    const upload = multer({ storage });

    // Endpoint to upload video details and video file
    app.post("/videoDetails", upload.single("videoFile"), async (req, res) => {
      try {
        const { title, description, name, email } = req.body;
        const likes = JSON.parse(req.body.likes);
        const comments = JSON.parse(req.body.comments);
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
            name,
            email,
            fileId: file._id,
            filename: file.filename,
            uploadDate: file.uploadDate,
            videoUrl: `http://localhost:${port}/videos/${file._id}`,
            likes,
            comments,
            // Store HTTP link
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
    app.post("/videoDetails/:id/like", async (req, res) => {
      const { id } = req.params;
      const { userEmail, userName } = req.body;

      try {
        const video = await videoCollection.findOne({ _id: new ObjectId(id) });
        if (!video) {
          return res.status(404).json({ message: "Video not found" });
        }

        // Add user to likes array
        video.likes.push({ userEmail, userName });

        // Update the video with the new likes
        await videoCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { likes: video.likes } }
        );

        res.status(200).json({ message: "Video liked successfully!" });
      } catch (error) {
        console.error("Error liking video:", error);
        res.status(500).json({ message: "Error liking video" });
      }
    });

    //dislike
    app.delete("/videoDetails/:id/dislike", async (req, res) => {
      const videoId = req.params.id; // ID of the video
      const { userEmail } = req.body; // Email of the user to remove

      try {
        // Ensure `videoId` and `userEmail` are valid
        if (!videoId || !userEmail) {
          return res
            .status(400)
            .json({ message: "Invalid video ID or user email" });
        }

        // Use MongoDB's updateOne with $pull to remove the userEmail from the likes array
        const result = await videoCollection.updateOne(
          { _id: new ObjectId(videoId) }, // Match the video by ID
          { $pull: { likes: { userEmail } } } // Remove the object from likes array where userEmail matches
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Video not found" });
        }

        // Retrieve the updated document (optional but helps verify the result)
        const updatedVideo = await videoCollection.findOne({
          _id: new ObjectId(videoId),
        });

        res
          .status(200)
          .json({ message: "Disliked successfully!", updatedVideo });
      } catch (error) {
        res.status(500).json({ message: "Error disliking video", error });
      }
    });

    //post for comment
    app.post("/videoDetails/:id/comment", async (req, res) => {
      const { id } = req.params;
      const { userEmail, userName, comment, time } = req.body;
      console.log(req.body);

      try {
        const video = await videoCollection.findOne({ _id: new ObjectId(id) });
        if (!video) {
          return res.status(404).json({ message: "Video not found" });
        }

        // Add user to likes array
        video.comments.push({ userEmail, userName, comment, time });

        // Update the video with the new likes
        await videoCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { comments: video.comments } }
        );

        res.status(200).json({ message: "comment successfullty!" });
      } catch (error) {
        console.error("Error comment video:", error);
        res.status(500).json({ message: "Error commentvideo" });
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

    //API for admin

    app.post("/admin", async (req, res) => {
      const newUser = req.body;
      const result = await adminCollection.insertOne(newUser);
      res.json(result);
    });

    app.get("/admin", async (req, res) => {
      const user = await adminCollection.findOne({});
      res.send(user);
    });

    //delete video
    app.delete("/videoDetails/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid ID format" });
      }

      const query = { _id: new ObjectId(id) };

      try {
        const result = await videoCollection.deleteOne(query);
        if (result.deletedCount === 1) {
          // console.log("Item deleted:", result);
          res.json({ message: "Item deleted successfully", result });
        } else {
          res.status(404).json({ error: "Item not found" });
        }
      } catch (error) {
        // console.error("Error deleting item:", error);
        res.status(500).json({ error: "Failed to delete item" });
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
