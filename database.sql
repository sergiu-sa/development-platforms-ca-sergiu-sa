CREATE DATABASE IF NOT EXISTS news_api;
USE news_api;


CREATE TABLE IF NOT EXISTS users (
  
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



CREATE TABLE IF NOT EXISTS articles (
   
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    submitted_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO users (email, password_hash) VALUES
('test@test.com', '$2b$10$rQZ5hGz5Z5Z5Z5Z5Z5Z5ZOxK5K5K5K5K5K5K5K5K5K5K5K5K5K5K5');



INSERT INTO articles (title, body, category, submitted_by) VALUES
(
    'The Future of Artificial Intelligence in 2024',
    'Artificial intelligence continues to reshape industries worldwide. From healthcare diagnostics to autonomous vehicles, AI is becoming increasingly integrated into our daily lives. Experts predict that by 2025, AI will be responsible for creating more jobs than it displaces, though the nature of work will fundamentally change. Companies are investing billions in AI research, with a particular focus on making these systems more transparent and ethical.',
    'Tech',
    1
),
(
    'Local Football Team Wins Championship After 20 Years',
    'In a thrilling final match that went to extra time, the local football team secured their first championship title in two decades. The winning goal came in the 118th minute, sending fans into wild celebration. Coach Martinez credited the team''s success to months of rigorous training and an unbreakable team spirit. The victory parade is scheduled for next Saturday through the city center.',
    'Sports',
    1
),
(
    'New Environmental Policy Aims to Reduce Carbon Emissions',
    'The government announced a comprehensive environmental policy today that aims to cut carbon emissions by 50% over the next decade. The policy includes incentives for electric vehicle adoption, stricter regulations on industrial emissions, and significant investment in renewable energy infrastructure. Environmental groups have praised the initiative while some industry leaders express concerns about implementation costs.',
    'Politics',
    1
),
(
    'Revolutionary Battery Technology Could Double Electric Car Range',
    'Scientists at the National Research Laboratory have developed a new solid-state battery technology that could potentially double the range of electric vehicles. The breakthrough involves a novel electrolyte material that is both safer and more energy-dense than current lithium-ion batteries. Major automotive manufacturers have already expressed interest in licensing the technology, with commercial applications expected within three years.',
    'Tech',
    1
),
(
    'International Food Festival Returns This Weekend',
    'After a three-year hiatus, the beloved International Food Festival returns to Central Park this weekend. Over 50 vendors representing cuisines from around the world will offer dishes ranging from authentic Thai street food to traditional Italian pasta. The event also features live cooking demonstrations, cultural performances, and a children''s area with fun activities. Entry is free, with food items priced between $5 and $15.',
    'Entertainment',
    1
);
