import QtQuick
import QtQuick.Shapes
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Tide pill: a mini water gauge (level between LOW and HIGH of the current
// half-cycle) with a ▲/▼ set into it for rising/falling, next to the time
// until the tide turns ("5h13"), with a searchable tide-curve popup owned by
// Panel.qml. The exact clock time is in the hover tooltip. Left click opens the panel,
// middle click refreshes.
BarWidget {
  id: root
  moduleName: "gnosis.tide"

  readonly property var panel: panelLoader.item
  readonly property real phaseFraction: panel && panel.phaseInfo ? panel.phaseInfo.fraction : 0
  readonly property bool rising: !!(panel && panel.phaseInfo && panel.phaseInfo.rising)
  // The gauge only means something with a live half-cycle to sit in.
  readonly property bool hasData: !!(panel && panel.phaseInfo)

  // Hover tooltip: location + tide state + current level. Adds the context the
  // pill itself cannot show (which shore, which phase, how high right now).
  readonly property string tooltip: (function() {
    var p = panelLoader.item
    if (!p) return ""
    if (!p.hasLocation) return "Search for a coastal place"
    // A level of exactly 0 m is real data, so test for a number, not truthiness.
    var hasLevel = !!p.tideNow && typeof p.tideNow.level === "number" && !isNaN(p.tideNow.level)
    if (p.dataLoaded && hasLevel) {
      var parts = [p.displayLocationName]
      if (p.stateText !== "") parts.push(p.stateText.toLowerCase())
      parts.push("now " + p.heightText(p.tideNow.level))
      // The pill shows a countdown; the clock time it lands on lives here.
      if (p.nextEventText !== "")
        parts.push(p.nextEventText.toLowerCase() + " at " + p.timeText(p.nextEvent.ms))
      return parts.join(" · ")
    }
    if (p.dataFailed) return p.displayLocationName + " · no tide data"
    return p.displayLocationName + " · …"
  })()

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function refresh() {
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing (Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root).
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.open) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  visible: panelLoader.item && panelLoader.item.label !== ""
  implicitWidth: pillRow.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: panelLoader.item ? panelLoader.item.label : ""
    hasVisualContent: text !== ""
    labelVisible: false
    horizontalMargin: 7
    verticalPadding: 7
    tooltipText: root.tooltip

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
  }

  // ---- Pill body: a mini water gauge carrying the tide's direction, plus
  //      the countdown until it turns.
  Item {
    id: pillBody
    anchors.centerIn: button
    width: pillRow.implicitWidth
    height: pillRow.implicitHeight

    Row {
      id: pillRow
      spacing: Style.space(5)

      // Mini gauge: a little tide column filling between LOW and HIGH water,
      // with a ▲/▼ set into it for rising/falling. The arrow is drawn twice
      // and clipped at the waterline — text colour over the empty part, the
      // theme background over the water — so it reads at any fill level.
      Item {
        id: gauge
        width: Style.space(11)
        height: Style.space(17)
        anchors.verticalCenter: parent.verticalCenter
        visible: root.hasData

        readonly property real fillHeight: Math.max(Style.spaceReal(2), gauge.height * root.phaseFraction)
        readonly property real arrowW: gauge.width - Style.spaceReal(4)
        readonly property real arrowH: Style.spaceReal(5)
        readonly property real arrowX: (gauge.width - gauge.arrowW) / 2
        readonly property real arrowY: (gauge.height - gauge.arrowH) / 2

        Rectangle {
          anchors.fill: parent
          radius: Style.spaceReal(2.5)
          color: Qt.rgba(button.foreground.r, button.foreground.g, button.foreground.b, 0.16)
        }

        Rectangle {
          anchors.horizontalCenter: parent.horizontalCenter
          anchors.bottom: parent.bottom
          width: parent.width
          height: gauge.fillHeight
          radius: Style.spaceReal(2.5)
          color: Color.accent
        }

        // Above the waterline.
        Item {
          anchors.top: parent.top
          width: parent.width
          height: gauge.height - gauge.fillHeight
          clip: true

          GaugeArrow {
            x: gauge.arrowX
            y: gauge.arrowY
            width: gauge.arrowW
            height: gauge.arrowH
            up: root.rising
            color: button.foreground
          }
        }

        // Below the waterline, knocked out of the fill.
        Item {
          anchors.bottom: parent.bottom
          width: parent.width
          height: gauge.fillHeight
          clip: true

          GaugeArrow {
            x: gauge.arrowX
            y: gauge.arrowY - (gauge.height - gauge.fillHeight)
            width: gauge.arrowW
            height: gauge.arrowH
            up: root.rising
            color: Color.background
          }
        }
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: panelLoader.item ? panelLoader.item.label : ""
        color: button.foreground
        font.family: button.fontFamily
        font.pixelSize: button.fontSize
      }
    }
  }

  // Solid triangle; a component of its own because the gauge draws it twice.
  // Inline components can't see this file's ids, so size and direction come
  // in as properties.
  component GaugeArrow: Shape {
    id: arrowShape
    property color color
    property bool up: false
    antialiasing: true

    ShapePath {
      strokeColor: "transparent"
      fillColor: arrowShape.color
      startX: 0
      startY: arrowShape.up ? arrowShape.height : 0
      PathLine { x: arrowShape.width; y: arrowShape.up ? arrowShape.height : 0 }
      PathLine { x: arrowShape.width / 2; y: arrowShape.up ? 0 : arrowShape.height }
      PathLine { x: 0; y: arrowShape.up ? arrowShape.height : 0 }
    }
  }
}
