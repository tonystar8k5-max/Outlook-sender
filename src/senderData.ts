/**
 * SENDER DATA CONFIGURATION
 * 
 * SCALE: This system is optimized for high volume. You can paste 10,000, 20,000, or even 100,000+ 
 * entries here without any performance issues.
 * 
 * USAGE: 
 * - Standard Tag: #NAME# picks from CUSTOM_NAMES
 * - Standard Tag: #ADDRESS# picks from CUSTOM_ADDRESSES
 * - Specific Tag: #SENDERNAME# picks from SENDER_NAMES_SPECIFIC
 * 
 * PERSISTENCE: The system remembers your position even if you restart the app, 
 * ensuring you always pick new names/addresses until the list is completed.
 */

export const CUSTOM_NAMES = [
  "James Wilson", "Sarah Miller", "Robert Davis", "Michael Brown", "Emily Chen",
  "David Miller", "Linda Taylor", "Christopher Anderson", "Jessica Thomas", "Daniel Jackson",
  "Feterl Marcine. \"Marcy\"", "Sophia Garcia", "Matthew Rodriguez", "Olivia Martinez", "Andrew Hernandez",
  "Isabella Moore", "Joshua Martin", "Charlotte Jackson", "Ethan Thompson", "Amelia White",
  "John Doe", "Jane Smith", "Alice Johnson", "Bob Lee", "Charlie Brown",
  "David Wilson", "Eva Green", "Frank Miller", "Grace Taylor", "Henry Anderson",
  "Ivy Thomas", "Jack Jackson", "Kelly White", "Liam Harris", "Mia Martin",
  "Noah Thompson", "Olivia Garcia", "Paul Rodriguez", "Quinn Martinez", "Ryan Hernandez",
  "Sarah Moore", "Thomas Jackson", "Ursula White", "Victor Thompson", "Wendy White",
  "Xavier Harris", "Yara Martin", "Zane Thompson", "Arthur Morgan", "Dutch van der Linde",
  "John Marston", "Sadie Adler", "Charles Smith", "Micah Bell", "Bill Williamson",
  "Lenny Summers", "Hosea Matthews", "Abigail Roberts", "Jack Marston", "Karen Jones",
  "Mary-Beth Gaskill", "Tilly Jackson", "Leopold Strauss", "Simon Pearson", "Susan Grimshaw",
  "Molly O'Shea", "Uncle", "Josiah Trelawny", "Reverend Swanson", "Sean MacGuire",
  "Kieran Duffy", "Eagle Flies", "Rains Fall", "Albert Mason", "Hamish Sinclair",
  "Charlotte Balfour", "Sister Calderon", "Brother Dorkins", "Edith Downes", "Archie Downes"
  // You can paste 20,000+ more names here:
  // "Name 1", "Name 2", "Name 3", ...
];

export const CUSTOM_ADDRESSES = [
  "401 E 7th St, Alice, TX 78332",
  "401 e 80th st, New york, NY 10075",
  "401 E 86th St, New York, NY 10028",
  "1520 Market St, Philadelphia, PA 19102",
  "888 Broadway, New York, NY 10003",
  "123 Business Rd, Suite 100, New York, NY 10001",
  "456 Corporate Blvd, London, UK",
  "789 Innovation Way, San Francisco, CA 94105",
  "321 Industrial Ave, Chicago, IL 60601",
  "654 Commercial Lane, Miami, FL 33101",
  "101 Tech Drive, Austin, TX 78701",
  "202 Maple Ave, Toronto, ON M5H 2N2",
  "303 Cedar St, Vancouver, BC V6B 1A1",
  "404 Pine St, Seattle, WA 98101",
  "505 Oak St, Portland, OR 97201",
  "606 Cherry St, Denver, CO 80201",
  "707 Walnut St, Boston, MA 02101",
  "808 Birch St, Atlanta, GA 30301",
  "909 Elm St, Phoenix, AZ 85001"
  // You can paste 20,000+ more addresses here:
  // "Addr 1", "Addr 2", "Addr 3", ...
];

export const SENDER_NAMES_SPECIFIC = [
  "Nexa Official", "System Support", "Compliance Team", "Direct Admin", "Verification Dept",
  "Security Gateway", "Global Logistics", "Nexa Nexus", "Primary Sender", "Auto Dispatcher"
  // Add more specific names if needed
];
