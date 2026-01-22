CREATE DATABASE  IF NOT EXISTS `news_api` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `news_api`;
-- MySQL dump 10.13  Distrib 8.0.44, for macos15 (x86_64)
--
-- Host: 127.0.0.1    Database: news_api
-- ------------------------------------------------------
-- Server version	9.5.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '860684e8-f564-11f0-b87c-cbbd5260ec80:1-13';

--
-- Table structure for table `articles`
--

DROP TABLE IF EXISTS `articles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `articles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `category` varchar(100) NOT NULL,
  `submitted_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `submitted_by` (`submitted_by`),
  CONSTRAINT `articles_ibfk_1` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `articles`
--

LOCK TABLES `articles` WRITE;
/*!40000 ALTER TABLE `articles` DISABLE KEYS */;
INSERT INTO `articles` VALUES (1,'The Future of Artificial Intelligence in 2024','Artificial intelligence continues to reshape industries worldwide. From healthcare diagnostics to autonomous vehicles, AI is becoming increasingly integrated into our daily lives. Experts predict that by 2025, AI will be responsible for creating more jobs than it displaces, though the nature of work will fundamentally change. Companies are investing billions in AI research, with a particular focus on making these systems more transparent and ethical.','Tech',1,'2026-01-19 21:32:37'),(2,'Local Football Team Wins Championship After 20 Years','In a thrilling final match that went to extra time, the local football team secured their first championship title in two decades. The winning goal came in the 118th minute, sending fans into wild celebration. Coach Martinez credited the team\'s success to months of rigorous training and an unbreakable team spirit. The victory parade is scheduled for next Saturday through the city center.','Sports',1,'2026-01-19 21:32:37'),(3,'New Environmental Policy Aims to Reduce Carbon Emissions','The government announced a comprehensive environmental policy today that aims to cut carbon emissions by 50% over the next decade. The policy includes incentives for electric vehicle adoption, stricter regulations on industrial emissions, and significant investment in renewable energy infrastructure. Environmental groups have praised the initiative while some industry leaders express concerns about implementation costs.','Politics',1,'2026-01-19 21:32:37'),(4,'Revolutionary Battery Technology Could Double Electric Car Range','Scientists at the National Research Laboratory have developed a new solid-state battery technology that could potentially double the range of electric vehicles. The breakthrough involves a novel electrolyte material that is both safer and more energy-dense than current lithium-ion batteries. Major automotive manufacturers have already expressed interest in licensing the technology, with commercial applications expected within three years.','Tech',1,'2026-01-19 21:32:37'),(5,'International Food Festival Returns This Weekend','After a three-year hiatus, the beloved International Food Festival returns to Central Park this weekend. Over 50 vendors representing cuisines from around the world will offer dishes ranging from authentic Thai street food to traditional Italian pasta. The event also features live cooking demonstrations, cultural performances, and a children\'s area with fun activities. Entry is free, with food items priced between $5 and $15.','Entertainment',1,'2026-01-19 21:32:37'),(6,'My First Real Article','This is the content of my article. It needs to be at least 10 characters long.','Tech',2,'2026-01-20 19:19:34'),(7,'Article- Frontend interface','Testing FED','Entertainment',3,'2026-01-22 16:12:14');
/*!40000 ALTER TABLE `articles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'test@test.com','$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqhKLmzPgT.oD8I7xNzRBvbE6OKiW','2026-01-19 21:32:37'),(2,'sergiu@test.com','$2a$10$5HhxkcRwREuJIhW65GIXhu0So/PQVmM9aZqa6LQrLlKna9S.363v.','2026-01-20 15:17:32'),(3,'demo@test.com','$2a$10$ncuOLc40WS8MOUgF/QGN3.9UjMTD7T0iajw83MkrOBr829y4FfKAG','2026-01-22 10:32:56');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-22 19:54:04
