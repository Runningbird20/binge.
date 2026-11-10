package com.binge.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.binge.tv.data.Announcements
import com.binge.tv.data.AppModel
import com.binge.tv.data.Config
import com.binge.tv.data.CreditPerson
import com.binge.tv.data.People
import com.binge.tv.data.PersonPage
import com.binge.tv.data.Reminder

// The title page's Cast row: director or creators first, then the cast;
// each photo opens that person's page.
@Composable
fun CastRow(people: List<CreditPerson>) {
    Column(Modifier.padding(top = 18.dp)) {
        SectionTitle("Cast")
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                items(people, key = { it.id }) { person ->
                    Column(Modifier.width(96.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FocusCard(onClick = { Nav.push(Screen.Person(person.id, person.name)) }, shape = RoundedCornerShape(48.dp), modifier = Modifier.size(86.dp)) {
                            Art(person.photo, person.name, Modifier.fillMaxSize())
                        }
                        Text(person.name, style = Type.caption.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                        if (person.role.isNotEmpty()) Text(person.role, style = Type.caption, color = Palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}

// An actor's or director's page: photo, life line and bio, then their work on binge.
@Composable
fun PersonScreen(id: Int, name: String) {
    var page by remember(id) { mutableStateOf<PersonPage?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    var attempt by remember(id) { mutableStateOf(0) }
    LaunchedEffect(id, attempt) {
        failed = false
        page = People.load(id, AppModel.maturity)
        failed = page == null
    }
    PivotScroll(fraction = 0.3f) {
        LazyColumn(Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(top = 36.dp, bottom = 40.dp)) {
            item(key = "head") {
                Row(Modifier.padding(horizontal = Dimens.edge), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    Box(Modifier.width(150.dp).height(225.dp).clip(RoundedCornerShape(10.dp)).background(Palette.raised)) {
                        Art(page?.photo, name, Modifier.fillMaxSize())
                    }
                    Column(Modifier.widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(name, style = Type.hero, maxLines = 2)
                        listOfNotNull(page?.department, page?.lifeLine).joinToString("  ·  ").takeIf { it.isNotEmpty() }?.let {
                            Text(it, style = Type.callout.copy(fontWeight = FontWeight.SemiBold), color = Palette.muted)
                        }
                        page?.biography?.takeIf { it.isNotEmpty() }?.let {
                            // Focusable, so it can be reached and read with the remote.
                            FocusCard(onClick = {}, modifier = Modifier.fillMaxWidth().height(150.dp)) {
                                Text(it, style = Type.callout, color = Color.White.copy(alpha = 0.85f), maxLines = 7, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(12.dp))
                            }
                        }
                    }
                }
            }
            val current = page
            when {
                current != null && current.rows.isEmpty() -> item { Text("Nothing with $name is on binge. yet.", style = Type.headline, color = Palette.muted, modifier = Modifier.padding(Dimens.edge)) }
                current != null -> items(current.rows, key = { it.id }) { TitleRow(it, Nav::open) }
                failed -> item { ProblemView("Couldn't load $name's page right now.") { attempt++ } }
                else -> items(2) { RowSkeleton() }
            }
        }
    }
}

// Admin announcements (site_announcements), on Home, Movies, Series and Sports.
@Composable
fun AnnouncementBanner() {
    var current by remember { mutableStateOf<Announcements.Announcement?>(null) }
    LaunchedEffect(Unit) { current = Announcements.current() }
    val shown = current ?: return
    Row(Modifier.padding(horizontal = Dimens.edge, vertical = 10.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.raised).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (shown.level == "critical" || shown.level == "warning") Icons.Rounded.Warning else Icons.Rounded.Info, null,
            tint = if (shown.level == "critical") Color(0xFFFF8A80) else Color.White, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text(shown.message, style = Type.headline, maxLines = 3, overflow = TextOverflow.Ellipsis)
            // A TV can't open links: say where it goes.
            shown.linkUrl?.takeIf { it.isNotEmpty() }?.let { link ->
                Text("${shown.linkLabel ?: "More"} at ${if (link.startsWith("/")) Config.siteUrl.removePrefix("https://") + link else link}", style = Type.caption, color = Palette.muted, maxLines = 1)
            }
        }
        Pill("Dismiss") { Announcements.dismiss(shown.id); current = null }
    }
}

// Reminders that are due: open the title, or dismiss.
@Composable
fun ReminderBanner(reminders: List<Reminder>, open: (Reminder) -> Unit, dismiss: (Reminder) -> Unit) {
    Column(Modifier.padding(horizontal = Dimens.edge, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        reminders.take(3).forEach { reminder ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.raised).padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Notifications, null, modifier = Modifier.size(20.dp))
                Text("${reminder.title} is ready to watch.", style = Type.headline, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Pill("Open", selected = true) { open(reminder) }
                Pill("Dismiss") { dismiss(reminder) }
            }
        }
    }
}
